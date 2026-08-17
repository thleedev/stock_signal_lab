# 라씨 신호 API 역분석 (접근성 대체)

> 조사일: 2026-08-03  
> 목적: 영웅문 Accessibility 스크래핑을 대체할 네트워크 경로 확보  
> 상태: **서버 수집 가동 중** — Thinkpool API 확인 · `/api/v1/cron/lassi-signals` 구현 · GitHub Actions `daily-batch.yml` 스케줄 연결 · Android 접근성 라씨 경로 비활성 (2026-08-06) · 스케줄 자동 비활성화 복구 및 `keepalive.yml` 방어 추가 (2026-08-07)

---

## 1. 결론 요약

| 항목 | 결과 |
|------|------|
| 키움 OpenAPI+ | 시세·주문용. 라씨 AI 신호 없음 |
| 영웅문 딥링크 | `i.kiwoom.com/_rassi` → `invest.kiwoom.com/inv/mts/2806` (앱 화면 이동 브릿지) |
| 실제 신호 데이터 원천 | **씽크풀(Thinkpool)** — 키움 라씨 제휴 공급사 |
| 전량 목록 API | `GET https://api.thinkpool.com/signal/{B\|S}/signalTodayBuySellList` |
| Thinkpool 목록 인증 | 조사 시점 기준 **쿠키/토큰 없이 200 + 전량 JSON** |
| UI 게이트 | 웹은 로그인·유료(`isPremium`)일 때만 목록을 **표시**. API 자체는 개방 상태 |
| **실행 위치** | **서버 크론** (Android 아님). 폰·접근성·영웅문 로그인 불필요 |
| Android 접근성 | 라씨 경로 **비활성** (매니페스트 등록 해제 + 코드 가드). 클래스는 복구용으로 보존 |

접근성 실패(메뉴 미탐색, WebView 스크롤 불가 등)를 우회하려면, 영웅문 UI를 자동화하지 말고 **Thinkpool 신호 API를 서버에서 직접 호출**합니다.

### 1.1 Android vs 서버 — 누가 무엇을 하나

| 경로 | 담당 | 비고 |
|------|------|------|
| **라씨 전량** | **서버** `GET/POST /api/v1/cron/lassi-signals` | Thinkpool HTTP → `upsert_signals_bulk` |
| 스톡봇·퀀트·알파캐치 SMS | Android | 기존 유지 |
| 라씨 **화면 스크래핑** | — | **비활성** (Phase B에서 매니페스트 등록 해제) |
| 라씨 SMS | Android | 폴백으로만 유지 (`is_fallback=true`, 가격 없음) |
| 알파캐치 **화면 스크래핑** | Android 접근성 | 기존 유지 (17:00 알람) |
| PRIZM | 텔레그램 웹훅 (서버) | 기존 유지 |

```
[스케줄러: GitHub Actions daily-batch.yml]
        │  prices-only 장중 15분 간격 · full 16:10 KST(?force=1)
        │  Authorization: Bearer CRON_SECRET
        ▼
[Next.js] /api/v1/cron/lassi-signals
        │  (수집 시간 가드: KST 월~금 09:00~15:45, force=1 우회)
        │  (키움·씽크풀 로그인 없음)
        ▼
[Thinkpool] GET .../signal/B|S/signalTodayBuySellList
        │
        ▼
[Supabase] upsert_signals_bulk  (service role)
        │
        ▼
 BUY enrich · AI 추천 트리거 (비동기)
```

**키움/영웅문 세션을 서버로 옮기지 않습니다.**  
목록 API가 무인증이라 서버가 공개 URL만 호출하면 됩니다.

### 1.2 인증은 두 갈래 (혼동 주의)

| 구간 | 방향 | 인증 방식 | 설명 |
|------|------|-----------|------|
| **A. 수집 트리거** | 스케줄러 → 우리 서버 | `Authorization: Bearer {CRON_SECRET}` | 아무나 크론을 돌리지 못하게 막는 **우리 쪽 보호** |
| **B. 신호 데이터** | 우리 서버 → Thinkpool | **없음** (현재) | 키움 로그인·씽크풀 쿠키·API 키 불필요 |
| **C. DB 저장** | 우리 서버 → Supabase | service role (`createServiceClient`) | 기존 API 라우트와 동일 |

- `CRON_SECRET` 미설정(로컬) 시 A는 생략됩니다 (`cron/market-events` 와 동일 패턴).
- 운영(Vercel)에서는 `CRON_SECRET` 을 반드시 설정합니다.
- Thinkpool이 나중에 B에 401을 걸면, 트래픽 캡처로 쿠키/`Secrete_Token` 을 확보해 서버 환경변수로 넣는 **별도 작업**이 필요합니다. 현재 구현에는 그 값이 없습니다.

### 1.3 영웅문 로그인 ≠ Chrome 씽크풀 로그인

| 환경 | 세션 |
|------|------|
| 영웅문 앱 (WebView) | 키움 로그인·앱 전용 쿠키. Chrome과 **공유되지 않음** |
| Chrome `m.thinkpool.com` | 씽크풀 웹 계정만. 영웅문 로그인과 **무관** |
| 서버 크론 | 둘 다 쓰지 않음. 공개 목록 API만 호출 |

Chrome에서 `/signal/buy` 가 “로그인하라”고 나와도 정상입니다.  
UI 게이트일 뿐이며, 서버 수집 경로와 무관합니다.  
검증 시에는 브라우저 로그인 대신 API URL을 직접 호출하면 됩니다.

```
https://api.thinkpool.com/signal/B/signalTodayBuySellList
https://api.thinkpool.com/signal/S/signalTodayBuySellList
```

---

## 2. 엔드포인트 맵

### 2.1 전량 수집 (핵심)

```
GET https://api.thinkpool.com/signal/B/signalTodayBuySellList
GET https://api.thinkpool.com/signal/S/signalTodayBuySellList
```

권장 헤더:

```
Accept: application/json
Origin: https://m.thinkpool.com
Referer: https://m.thinkpool.com/signal
User-Agent: Mozilla/5.0 ...
```

경로 세그먼트는 반드시 `B` / `S` 입니다. `buy`/`sell` 은 400 검증 오류입니다.

#### 응답 스키마 (2026-08-03 실측)

```json
{
  "totalCount": 56,
  "list": [
    {
      "stockCode": "000157",
      "stockName": "두산2우B",
      "tradeDttm": "20260803150000",
      "elapsedTmTx": "40분전",
      "tradePrice": 340000,
      "profitRate": 0.0
    }
  ]
}
```

| 필드 | 의미 | DashboardStock 매핑 |
|------|------|---------------------|
| `stockCode` | 6자리 종목코드 | `symbol` |
| `stockName` | 종목명 | `name` |
| `tradeDttm` | `YYYYMMDDHHmmss` (KST 가정) | `signal_time` |
| `tradePrice` | 신호 가격 | `signal_price` |
| `elapsedTmTx` | `"40분전"` 또는 `"14:20"` | `raw_data` 보조 |
| `profitRate` | 수익률 | `raw_data` |
| 경로 `B`/`S` | 매수/매도 | `signal_type` = `BUY` / `SELL` |
| — | — | `source` = `lassi` |

실측 규모 (2026-08-03 15:40경): 매수 56 · 매도 35.  
`periodProfit.buyCount/sellCount` 및 `TR_SIGNAL09.buyCount/sellCount` 와 일치합니다.

웹 프론트(`m.thinkpool.com/_nuxt` 청크 131)는 목록 **표시**만 유료 회원에게 허용합니다.  
데이터 fetch 자체는 `$commonAxios.get` 으로 수행하며, 조사 시점에는 서버가 목록을 막지 않았습니다.

```text
// 청크 요약 (난독화 해제 개념)
tradeFlag = tradeType === "buy" ? "B" : "S"
GET /signal/{tradeFlag}/signalTodayBuySellList
if (isLogin && isPremium) → list 렌더
else → 가입 유도 모달
```

### 2.2 요약·샘플 (공개)

| 메서드 | URL | 용도 |
|--------|-----|------|
| GET | `https://api.thinkpool.com/signal/periodProfit` | 당일 buy/sell/hold/wait 카운트, 승률 등 |
| GET | `https://api.thinkpool.com/signal/popular/itemInfoList` | 인기 종목 샘플 |
| GET | `https://api.thinkpool.com/signal/briefing` | 주간 브리핑 메타 |
| POST | `https://rassiapp.thinkpool.com:47700/rassi_ext/TR_SIGNAL09` body `{"userId":"TP_MOBILE"}` | 당일 카운트 + 하이라이트 10건 |
| POST | `https://rassiapp.thinkpool.com:47700/rassi_ext/TR_TODAY01` body `{"userId":"TP_MOBILE"}` | 최근 매수/매도/보유 TOP 등 섹션 목록 |
| POST | `https://rassiapp.thinkpool.com:47700/rassi_ext/TR_FIND01` body `{"userId":"TP_MOBILE","selectCount":"5"}` | 급등 등 샘플 |

`TR_*` 공통 응답:

```json
{ "trCode": "...", "retCode": "0000", "retMsg": "...", "retData": ... }
```

### 2.3 인증 필요 (회원·관심종목)

| URL | 비고 |
|-----|------|
| `GET https://api.thinkpool.com/signal/paidMemberChk` | 미로그인 시 401 |
| `GET https://api.thinkpool.com/auth/loginStatus` | 401 |
| `POST .../TR_POCK04` | `list_Stock` 관심 포켓 (userId 필요) |
| `GET https://api.thinkpool.com/signal/myItems` | 나의 종목 |

CORS 허용 헤더에 `Authorization`, `Secrete_Token`(오타 그대로) 이 노출되어 있어, 앱 트래픽 캡처 시 이 헤더를 우선 관찰하면 됩니다.

### 2.4 영웅문 딥링크 → 화면 코드

| SMS 바로가기 | 최종 URL | 화면 |
|--------------|----------|------|
| `https://i.kiwoom.com/_rassi` | `invest.kiwoom.com/inv/mts/2806` | 라씨 |
| `https://i.kiwoom.com/_q` | `.../mts/2768` | 퀀트 |
| `https://i.kiwoom.com/_stb` | `.../mts/2751` | 스톡봇 |

브릿지 JS(`mtsInterface.js`)는 WebView 브리지 `JSCallBack.postMessage` 로 `activityGoto(screen_id)` 만 호출합니다. **신호 JSON을 내려주지 않습니다.**

---

## 3. SignalInput 변환 규칙 (제안)

```
tradeFlag path B → signal_type BUY
tradeFlag path S → signal_type SELL
tradeDttm "20260803150000" → signal_time Asia/Seoul ISO-8601
tradePrice → signal_price
source = "lassi"
is_fallback = false
raw_data = { tradeDttm, elapsedTmTx, profitRate, provider: "thinkpool" }
```

기존 접근성 파서와의 차이:

| | 화면 스크래핑 | Thinkpool API |
|--|---------------|---------------|
| 전량 여부 | 스크롤 성공 시에만 | `totalCount` 로 검증 가능 |
| 가격 | 화면 텍스트 파싱 | `tradePrice` 숫자 |
| 시각 | 장중 상대시간 → 17:00 재수집 보정 | `tradeDttm` 절대시각 (보정 알람 불필요) |
| 종목코드 | 파싱 오류 가능 | `stockCode` 고정 6자리 |

`elapsedTmTx` 가 `"40분전"` 이어도 `tradeDttm` 이 절대시각을 갖고 있으므로, **17:00 라씨 시간 보정 스크래핑은 폐지했습니다** (Phase B).

---

## 4. 수집 아키텍처 (채택: 서버 크론)

### 4.1 채택안 — 서버 폴링

**Android에서 하지 않습니다.** Next.js API 라우트가 Thinkpool을 직접 호출합니다.

```
스케줄러 (GitHub Actions daily-batch.yml / 수동 curl)
  → Authorization: Bearer CRON_SECRET
  → GET|POST /api/v1/cron/lassi-signals
       · 수집 시간 가드 밖이면 skipped 반환 (force=1 우회)
       · dry_run=1 이면 DB 미기록
  → collectLassiSignals()  (web/src/lib/thinkpool-lassi.ts)
       · Thinkpool B/S 병렬 GET  ← 인증 헤더 없음
  → toUpsertPayload() → upsert_signals_bulk
  → collector_heartbeats (device_id=thinkpool-api)
  → BUY enrichSignalStocks + AI 추천 트리거 (비동기)
```

| 장점 | 설명 |
|------|------|
| 폰 불필요 | 접근성·포그라운드·영웅문 실행 없음 |
| 인증 단순 | 키움 세션 이전 불필요 (목록 API 무인증) |
| 시각 보정 불필요 | `tradeDttm` 절대시각 → 17:00 재스크래핑 폐지 가능 |
| 기존 SMS 유지 | 스톡봇·퀀트·알파캐치 SMS는 Android 그대로 |

### 4.2 비채택 — Android 내 HTTP (대안만 기록)

- `SignalApiClient` 옆에 Thinkpool 클라이언트를 둘 수도 있음  
- 네트워크만 있으면 동작하지만, 폰 상시 가동·배포 부담이 커서 **주 경로로 채택하지 않음**

### 4.3 알파캐치

이번 범위의 Thinkpool 라씨 API와 **별개**입니다.  
알파캐치 보유·신호는 키움 앱 내부 또는 다른 호스트일 가능성이 큽니다 → 5절 트래픽 캡처.

---

## 5. 기기 트래픽 캡처 플레이북 (인증 엔드포인트·알파캐치용)

실무 런북·스크립트는 저장소에 분리해 두었습니다.

| 경로 | 내용 |
|------|------|
| `tools/traffic-capture/RUNBOOK.md` | 폰 설정·시나리오 S1~S5·피닝 대응 |
| `tools/traffic-capture/start-capture.sh` | mitmweb/mitmdump 기동 + adb reverse |
| `tools/traffic-capture/install-ca-android.sh` | CA 푸시 |
| `tools/traffic-capture/addon_filter.py` | 관심 호스트만 `out/` 에 JSON 저장 |
| `tools/traffic-capture/findings-template.md` | 결과 기록 양식 |

```bash
bash tools/traffic-capture/install-ca-android.sh
bash tools/traffic-capture/start-capture.sh lassi-browser web
# 브라우저 UI: http://127.0.0.1:8081
```

전량 라씨 목록은 무인증으로 이미 확보됐지만, 캡처로 확인할 것:

1. 로그인 후 추가 호출·쿠키/`Secrete_Token`  
2. **알파캐치** 목록·보유 종목 API (미확보)  
3. 영웅문이 thinkpool 을 쓰는지, 키움 전용 호스트인지  
4. Thinkpool 이 목록 API 에 인증을 걸었을 때의 대비

### 5.1 필터 키워드

```
thinkpool.com
rassiapp.thinkpool.com
api.thinkpool.com
signalTodayBuySellList
rassi_ext
TR_SIGNAL
TR_TODAY
Secrete_Token
invest.kiwoom.com
kiwoom.com
alphacatch
알파
```

### 5.2 산출물 체크리스트

- [x] 전량 목록 URL (`signalTodayBuySellList`) — 2026-08-03 실측  
- [ ] 인증 헤더/쿠키 이름과 수명 (S2)  
- [ ] 알파캐치 목록·보유 종목 URL (S4)  
- [ ] rate limit / 차단 징후  
- [ ] 응답 필드 ↔ `SignalInput` 매핑표 (라씨는 초안 완료)

---

## 6. 리스크·준수

가장 큰 리스크는 비공식 API라는 점입니다. 경로·스키마·인증 정책이 언제든 바뀔 수 있고, Thinkpool이 목록에 401을 걸면 캡처로 자격 증명을 확보하기 전까지 수집이 끊깁니다. 그 상황에서 남는 것은 SMS 라씨 폴백뿐이므로, `collector_heartbeats` 의 `thinkpool-api` 상태와 당일 라씨 건수로 조기에 감지해야 합니다.

접근성 코드를 삭제하지 않고 비활성화만 해 둔 이유도 이 복구 여지를 남기기 위해서입니다. 매니페스트 등록과 `LASSI_SCRAPING_ENABLED` 상수를 되돌리면 옛 경로가 그대로 살아납니다.

1. **이용약관** — 자동화 수집이 약관에 위배될 수 있습니다. **본인 가입 서비스 범위의 개인 수집**으로 한정하고, 재배포·공유를 하지 않는 것을 권장합니다.  
2. **UI는 유료 게이트** — 웹은 프리미엄 사용자에게만 목록을 보여 줍니다. API 개방 상태와 UI 정책이 다를 수 있습니다.  
3. **OpenAPI+ 와 혼동 금지** — 키움 OpenAPI는 이 데이터와 무관합니다.  
4. **CRON_SECRET 유출** — 외부에서 우리 크론을 임의 호출할 수 있으므로 운영 시크릿을 공개 저장소·클라이언트에 넣지 않습니다.

---

## 7. 구현 현황

### Phase A — 완료 (2026-08-03) · **서버 전용**

Android 앱 코드는 수정하지 않았습니다. 전부 `web/` 서버 측입니다.

| 파일 | 역할 |
|------|------|
| `web/src/lib/thinkpool-lassi.ts` | B/S fetch · `SignalInput` 매핑 · upsert payload |
| `web/src/lib/thinkpool-lassi.test.ts` | `docs/B|S_signalTodayBuySellList.json` fixture 테스트 |
| `web/src/app/api/v1/cron/lassi-signals/route.ts` | 수집 + `upsert_signals_bulk` + enrich 트리거 |

#### 호출 예시

수동 호출은 수집 시간대 밖이면 `skipped` 로 끝나므로, 장 마감 뒤 확인할 때는 `force=1` 을 함께 넘깁니다.

```bash
# dry-run (Thinkpool 조회·매핑만, DB 미기록)
curl -s "https://<배포도메인>/api/v1/cron/lassi-signals?dry_run=1&force=1" \
  -H "Authorization: Bearer $CRON_SECRET"

# 실제 upsert
curl -s -X POST "https://<배포도메인>/api/v1/cron/lassi-signals?force=1" \
  -H "Authorization: Bearer $CRON_SECRET"
```

로컬:

```bash
curl -s "http://localhost:3000/api/v1/cron/lassi-signals?dry_run=1&force=1" \
  -H "Authorization: Bearer $CRON_SECRET"
```

#### 이 엔드포인트의 인증 (다시 정리)

| 검사 | 내용 |
|------|------|
| 요청 헤더 | `Authorization: Bearer {CRON_SECRET}` |
| `CRON_SECRET` 있음 | 불일치 시 **401** |
| `CRON_SECRET` 없음 | 로컬 개발용으로 인증 생략 |
| Thinkpool 호출 시 | 별도 키/쿠키 **미전송** |
| DB | `createServiceClient()` service role |

응답 요약 필드 예: `buy_count`, `sell_count`, `mapped`, `upserted`, `batch_id`, `device_id` 개념상 `thinkpool-api`.

실측 fixture: `docs/B_signalTodayBuySellList.json`, `docs/S_signalTodayBuySellList.json`.

### 스케줄 연결 — 완료 (2026-08-06)

실제 스케줄러는 GitHub Actions `.github/workflows/daily-batch.yml` 하나입니다. 크론 정의를 늘리지 않고 배치 스텝 `.github/scripts/batch/step11-lassi-signals.ts` 를 추가해, `step7-events.ts` 와 같은 방식으로 `https://${VERCEL_URL}/api/v1/cron/lassi-signals` 를 `Authorization: Bearer ${CRON_SECRET}` 로 호출합니다. Supabase pg_cron은 Hobby 플랜 제약이 있어 쓰지 않습니다.

| 모드 | 시점 | 호출 |
|------|------|------|
| `prices-only` | 장중 15분 간격 | `POST /api/v1/cron/lassi-signals` (시간 가드 적용) |
| `full` | 16:10 KST | `POST /api/v1/cron/lassi-signals?force=1` (당일 최종 확정) |
| `repair` | 07:00 KST | 호출하지 않음 |

수집 시간 가드는 배치가 아니라 **서버 라우트**에 있습니다. `isLassiCollectionWindow()` 가 KST 월~금 09:00~15:45 를 벗어난다고 판정하면 Thinkpool을 호출하지 않고 `{ ok: true, skipped: true, reason: 'outside-collection-window' }` 를 반환합니다. `prices-only` 는 08:00~08:45·09:00~20:45에 돌지만 라씨 신호는 정규장에서만 발생하므로, 장 마감 뒤 반복 호출은 가드에서 걸러집니다. `?force=1` 은 가드를 건너뛰므로 16:10 `full` 배치와 수동 `curl` 은 시간과 무관하게 수집합니다.

호출 실패는 `step5`·`step7` 과 같이 `summary.errors` 에 기록만 하고 배치를 중단시키지 않습니다.

**날짜 가드는 배치가 맡습니다.** 씽크풀은 당일 목록만 제공하고 서버는 수집 시각을 `timestamp` 로 기록하므로, `workflow_dispatch` 로 과거 일자를 지정해 재실행하면 지정일이 아니라 재실행일 자 신호가 한 벌 더 쌓입니다. UNIQUE 키가 `signal_date_kst(timestamp)` 라 원본 일자 행과 충돌하지 않아 스코어링과 AI 리포트가 이중 집계합니다. `runStep11LassiSignals` 는 기준일이 KST 오늘이 아니면 `force` 여부와 무관하게 호출 자체를 생략합니다.

### 스케줄 자동 비활성화 — 실제 중단과 방어 (2026-08-07)

**스케줄 연결만으로는 부족합니다.** GitHub Actions 는 저장소에 60일간 커밋이 없으면 스케줄 워크플로우를 자동으로 끕니다(`state=disabled_inactivity`). 워크플로우 실행 이력은 활동으로 치지 않으므로, `daily-batch` 가 매일 성공해도 커밋이 없으면 꺼집니다. 2026-06-04 부터 2026-08-06 까지 약 63일의 커밋 공백이 이 조건에 걸려 **2026-08-03 실행을 마지막으로 배치가 멈췄습니다.** 알림이 없어 나흘 뒤에야 발견했고, 그 사이 8월 4일 라씨 신호가 유실됐습니다. 씽크풀은 당일 목록만 제공하므로 소급 복구가 불가능합니다.

Android 접근성 라씨 경로를 비활성화한 뒤에는 서버 크론이 유일한 라씨 수집 경로이므로, 스케줄러가 꺼지면 SMS 폴백만 남고 사실상 수집이 끊깁니다.

방어는 `.github/workflows/keepalive.yml` 이 두 겹으로 맡습니다. 매월 1일·15일 06:00 KST 에 실행되어 `daily-batch` 상태를 조회하고 `active` 가 아니면 API 로 다시 켜며, 마지막 커밋이 30일 이상 지났으면 빈 커밋을 푸시해 무활동 타이머를 되돌립니다. 커밋이 생기면 `daily-batch` 와 `keepalive` 가 함께 살아남으므로 keepalive 자신이 꺼져 무력화되는 상황도 막힙니다. 실행 주기와 30일 조건을 합치면 늦어도 44일 근처에서 타이머가 초기화되어 60일 한도에 닿지 않습니다.

복구는 `gh workflow enable "Daily Batch"` 로 스케줄을 되살리고, 당일 몫은 `gh workflow run "Daily Batch" -f mode=full` 로 채웁니다. `full` 은 step11 을 `force=1` 로 호출하므로 수집 시간대 밖에서도 당일 신호를 확정합니다.

### 수집 품질 방어 장치

라우트와 클라이언트에 다음 세 가지가 들어 있습니다.

**휴장일 복제 차단** — `tradeDttm` 의 KST 날짜가 수집일과 다른 항목은 제외하고 제외 건수를 응답의 `stale_dropped` 로 돌려줍니다. 공휴일에 씽크풀이 직전 거래일 목록을 그대로 반환해도 전 거래일 신호가 휴장일자 행으로 복제되지 않습니다.

**보강 폭주 차단** — upsert 직전에 오늘자 `lassi` BUY 심볼을 한 번 조회해 **이번에 처음 등장한 심볼만** `enrichSignalStocks` 로 넘깁니다. 매 호출마다 전량(약 56종목)을 보강하면 장중 28회 실행으로 네이버·KRX·DART 외부 요청이 하루 수천 건이 됩니다. AI 추천 재생성도 신규 심볼이 있고 `force` 가 아닐 때만 트리거합니다.

**중단 감지** — 씽크풀 조회 실패(502), upsert 실패(500), 수집 0건 경로에 `status='error'` 하트비트를 남깁니다. 씽크풀이 401 대신 빈 목록을 주는 형태로 막히면 응답은 200이라 배치 로그가 정상으로 보이므로, 0건을 이상 징후로 취급해야 조용한 중단을 잡을 수 있습니다. `dry_run` 과 `skipped` 응답은 하트비트를 남기지 않습니다.

### 배포 절차

**마이그레이션 `078_collector_devices_latest_view.sql` 을 먼저 적용해야 합니다.** `thinkpool-api` 가 평일 약 29건의 하트비트를 남기면서, 수집기 화면들이 `collector_heartbeats` 를 행수 제한으로 읽던 방식으로는 Android 기기 카드가 목록에서 밀려나 사라집니다. 기기별 최신 1건만 노출하는 `collector_devices_latest` 뷰로 조회 기준을 바꿨으므로, 뷰가 없는 DB 에서는 `/collector` 와 `/settings` 가 빈 목록을 받고 `/api/v1/collector/status` 는 500을 반환합니다. 온라인 판정 임계도 하트비트 주기(15분)를 고려해 10분에서 20분으로 올렸습니다.

GitHub Actions 는 저장소에 올라간 코드로 돌기 때문에, 배치 스텝은 커밋·푸시해야 실제로 동작합니다.

### Phase B — Android 정리 (완료, 2026-08-06)

`AndroidManifest.xml` 에서 `KiwoomAccessibilityService` 의 `<service>` 등록을 해제했습니다. 클래스와 `LassiScreenParser` 는 그대로 두었으므로 복원할 때는 매니페스트 블록만 되돌리면 됩니다. 추가로 `startScraping()` 진입부에 `LASSI_SCRAPING_ENABLED = false` 상수 가드와 사유 주석을 두어, 매니페스트가 되살아나거나 다른 경로로 호출되어도 스크래핑이 시작되지 않습니다.

서비스가 등록되지 않으면 `KiwoomAccessibilityService.instance` 가 항상 `null` 이 되는데, 호출부 세 곳이 이미 `null` 분기를 갖고 있어 코드 수정이 필요 없었습니다. `NotificationListener` 는 경고 로그만 남기고, `StatusActivity` 는 라씨가 서버 수집으로 전환되었다는 안내 문구를 띄우며, `SignalTimeUpdateReceiver` 의 17:00 알람은 라씨 보정을 건너뛰고 **알파캐치 전용으로 자연 전환**됩니다.

`LassiSmsParser` 와 `SmsRouter` 의 LASSI 분기는 폴백으로 유지합니다. SMS 폴백은 `signal_time` 이 `null` 이라 `upsert_signals_bulk` 의 `COALESCE(EXCLUDED.signal_time, signals.signal_time)` 규칙상 서버가 넣은 절대시각을 덮어쓰지 않습니다.

### Phase C — 알파캐치

공개 Thinkpool형 API는 **미발견**. 조사 문서: `docs/10-alphacatch-api-investigation.md`.  
다음: 영웅문 앱 트래픽 캡처(S4) 후 분기 A/B/C.

### 성공 기준

- 당일 `totalCount` 와 DB `lassi` BUY/SELL 건수 일치 (또는 95% 이상)  
- **접근성 서비스 없이도** 라씨 수집 가능 (서버 크론만으로)  
- `signal_time` 이 상대시간 null 없이 저장됨  

---

## 8. 조사 중 확보한 공개 단서

| 단서 | 출처 |
|------|------|
| 딥링크 화면번호 2806/2768/2751 | `i.kiwoom.com` 302 추적 |
| WebView 브리지 command 목록 | `invest.kiwoom.com/inv/js/pages/mtsInterface.js` |
| `signalTodayBuySellList` | `m.thinkpool.com/_nuxt` 청크 131 (`fdda305.js`) |
| `TR_SIGNAL09` 등 | 청크 `a60d0f7.js` |
| 전량 응답 실측 | 2026-08-03 curl + `docs/B|S_*.json` fixture |

---

## 9. 참고: 기존 접근성 경로와의 관계

`docs/02-android-collector.md` 의 라씨 경로 (**비활성**, 복구용 보존):

- 푸시 → Accessibility → 메뉴 탐색 → 스크롤 → `LassiScreenParser`

**현재 유일 경로:**

- GitHub Actions → 서버 크론 → Thinkpool API → `upsert_signals_bulk`  
- 키움 로그인·Chrome 씽크풀 로그인·Android 접근성 **불필요**

스톡봇·퀀트 SMS, PRIZM 텔레그램, 알파캐치 화면 수집은 Android/웹훅 기존 경로를 그대로 유지합니다.
