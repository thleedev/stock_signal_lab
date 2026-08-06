# 라씨 수집의 서버 이관 설계

> 작성일: 2026-08-06
> 관련 문서: `docs/09-lassi-api-reverse-engineering.md`
> 상태: 승인됨

## 1. 배경

라씨매매신호는 Android 접근성 서비스가 영웅문 화면을 스크래핑해 수집해 왔습니다. 이 경로는 폰 상시 가동·키움 로그인·메뉴 탐색·WebView 스크롤에 모두 의존해 실패율이 높습니다.

역분석 결과 씽크풀(Thinkpool)이 당일 매수/매도 전량을 무인증 공개 API로 제공한다는 사실을 확인했습니다. 2026-08-06 재확인 시점에도 `totalCount=56`, `list` 길이 56으로 일치하며 HTTP 200을 반환합니다.

서버 수집기(Phase A)는 이미 구현되어 있습니다. `web/src/lib/thinkpool-lassi.ts`와 `/api/v1/cron/lassi-signals`가 B/S 전량을 받아 `upsert_signals_bulk`로 저장합니다. 다만 **어떤 스케줄러에도 연결되어 있지 않고 git에 커밋되지도 않았습니다.** 이 설계는 남은 연결과 Android 정리를 다룹니다.

## 2. 목표와 비목표

**목표**

라씨 수집을 서버 크론 단일 경로로 확정하고, Android 접근성 스크래핑을 되돌릴 수 있는 형태로 비활성화합니다.

**비목표**

알파캐치 수집 방식은 바꾸지 않습니다. 스톡봇·퀀트·알파캐치 SMS 경로와 PRIZM 텔레그램 웹훅도 그대로 둡니다. `KiwoomAccessibilityService`·`LassiScreenParser` 코드 삭제는 이번 범위 밖입니다.

## 3. 수집 스케줄

GitHub Actions `daily-batch.yml`이 이미 장중 15분 간격으로 `prices-only` 모드를 돌리고 있습니다. 크론 정의를 늘리지 않고 배치 스텝만 추가합니다. Supabase pg_cron은 Hobby 플랜 제약이 있어 쓰지 않습니다.

새 파일 `.github/scripts/batch/step11-lassi-signals.ts`가 `step7-events.ts`와 동일한 방식으로 `https://${VERCEL_URL}/api/v1/cron/lassi-signals`를 `Authorization: Bearer ${CRON_SECRET}`으로 호출합니다. 수집 로직은 `web/src/lib/thinkpool-lassi.ts`에 이미 있으므로 배치에 중복 구현하지 않습니다.

| 모드 | 시점 | 호출 |
|------|------|------|
| `prices-only` | 장중 15분 간격 | `POST /api/v1/cron/lassi-signals` (시간 가드 적용) |
| `full` | 16:10 KST | `POST /api/v1/cron/lassi-signals?force=1` (당일 최종 확정) |
| `repair` | 07:00 KST | 호출하지 않음 |

실패는 `step5`·`step7`과 같이 `summary.errors`에 기록만 하고 배치를 중단시키지 않습니다.

## 4. 수집 시간 가드

`prices-only`는 KST 08:00~08:45와 09:00~20:45에 돕니다. 라씨 신호는 정규장에서만 발생하므로 16시 이후 15분마다 같은 데이터를 다시 받을 이유가 없습니다.

가드는 배치 스크립트가 아니라 **서버 라우트에 둡니다.** `.github/scripts`에는 테스트 러너가 없어 배치 쪽 로직은 단위 테스트로 검증할 수 없습니다. 판정 함수를 `thinkpool-lassi.ts`에 두면 기존 vitest로 경계를 검증할 수 있고, 수동 `curl` 호출에도 같은 규칙이 적용됩니다.

```
isLassiCollectionWindow(date): boolean
  → KST 기준 월~금 09:00 이상 15:45 이하이면 true
```

라우트 동작은 다음과 같습니다. 가드 밖이면 Thinkpool을 호출하지 않고 `{ ok: true, skipped: true, reason: 'outside-collection-window' }`를 반환합니다. `?force=1`이면 가드를 건너뜁니다. `dry_run=1`은 기존대로 DB에 쓰지 않습니다.

## 5. Android 비활성화

`AndroidManifest.xml`에서 `KiwoomAccessibilityService`의 `<service>` 등록을 제거합니다. 클래스 파일과 `LassiScreenParser`는 남기므로 복원 시 매니페스트 블록만 되돌리면 됩니다.

서비스가 등록되지 않으면 `KiwoomAccessibilityService.instance`가 항상 `null`이 되는데, 호출부 세 곳이 이미 `null` 분기를 갖고 있습니다. `NotificationListener`는 경고 로그만 남기고, `StatusActivity`는 안내 문구를 띄우며, `SignalTimeUpdateReceiver`는 `KiwoomAccessibilityService.kt:49-50`에서 알파캐치를 직접 호출합니다. **17:00 알파캐치 스크래핑 경로가 코드 수정 없이 보존됩니다.**

의도를 코드에 남기기 위해 `startScraping()` 진입부에 `LASSI_SCRAPING_ENABLED = false` 상수 가드와 사유 주석을 넣습니다. 매니페스트가 되살아나거나 다른 경로로 호출되어도 스크래핑이 시작되지 않습니다. `StatusActivity`의 안내 문구는 라씨가 서버 수집으로 전환되었음을 알리도록 바꿉니다.

`LassiSmsParser`와 `SmsRouter`의 LASSI 분기는 유지합니다. SMS 폴백은 `signal_time`이 `null`이라 `upsert_signals_bulk`의 `COALESCE(EXCLUDED.signal_time, signals.signal_time)` 규칙상 서버가 넣은 절대시각을 덮어쓰지 않습니다.

## 6. 함께 고치는 회귀

`/api/v1/collector/status`가 `collector_heartbeats`를 `.limit(10)`으로 읽어 기기별 최신을 추출합니다. `thinkpool-api`가 장중 15분마다 하트비트를 남기면 최근 10건이 전부 그것으로 채워져 Android 기기들이 수집기 상태 화면에서 사라집니다. limit을 200으로 올려 기기 누락을 막습니다.

## 7. 데이터 정합성

`signals`의 UNIQUE 인덱스는 `(symbol, source, signal_type, signal_date_kst(timestamp))`입니다. `upsert_signals_bulk`는 충돌 시 `signal_time`·`batch_id`·`device_id`만 갱신하고 `signal_price`는 보존합니다. 라씨 신호 가격은 신호 발생 시점 가격이므로 하루 중 반복 호출에도 최초 값이 유지되는 편이 맞습니다.

접근성 경로가 남긴 기존 행과 서버 수집 행은 같은 키로 병합됩니다. `source='lassi'`가 동일하므로 중복 행이 생기지 않습니다.

## 8. 검증

`web`에서 `npm run test`(`thinkpool-lassi.test.ts` 확장 — 시간 가드 경계 09:00·15:45·16:00·주말), `npm run build`, `npm run lint`를 돌립니다. 배치 패키지는 `npx tsc --noEmit`로 타입만 확인합니다.

수동 검증은 `?dry_run=1&force=1`로 매핑을 확인하고, 실제 upsert 후 당일 `lassi` BUY/SELL 건수를 Thinkpool `totalCount`와 대조합니다.

Android는 컴파일 통과와 접근성 설정 목록에서 라씨 항목이 사라지는지 확인합니다.

## 9. 문서 갱신

`docs/09-lassi-api-reverse-engineering.md`의 Phase B를 완료로 바꾸고 스케줄 연결 내용을 반영합니다. `docs/02-android-collector.md`의 라씨 경로 설명도 서버 수집으로 정정합니다.

## 10. 구현 중 추가된 사항

리뷰에서 확인된 결함을 고치면서 설계에 없던 항목이 다섯 가지 늘었습니다.

**마이그레이션 078 (`collector_devices_latest` 뷰)** — 6절의 회귀 수정 대상을 잘못 짚었습니다. `/api/v1/collector/status` 는 저장소에 호출자가 없는 죽은 라우트였고, 실제 화면인 `collector/page.tsx` 와 `settings/page.tsx` 가 `collector_heartbeats` 를 직접 `.limit(20)` 으로 읽고 있었습니다. limit 을 키우는 방식은 하트비트가 늘면 재발하므로, `DISTINCT ON (device_id)` 뷰로 조회 기준을 바꿨습니다. 배포 전 마이그레이션 적용이 필요합니다.

**온라인 판정 임계 20분** — `thinkpool-api` 는 15분 주기라 기존 10분 임계로는 항상 오프라인으로 표시됩니다.

**휴장일 복제 차단** — `tradeDttm` 의 KST 날짜가 수집일과 다른 항목을 제외합니다. 공휴일에 `force=1` 로 도는 full 배치가 직전 거래일 목록을 휴장일자 신규 행으로 복제하는 것을 막습니다. 제외 건수는 응답의 `stale_dropped` 로 노출합니다.

**보강 대상 축소** — upsert 직전에 오늘자 `lassi` BUY 심볼을 조회해 신규 심볼만 `enrichSignalStocks` 로 넘깁니다. 매 호출 전량 보강은 장중 28회 실행에서 외부 API 요청을 하루 수천 건 늘립니다. AI 추천 트리거도 신규 심볼이 있고 `force` 가 아닐 때로 좁혔습니다.

**배치 날짜 가드** — `runStep11LassiSignals` 가 기준일이 KST 오늘이 아니면 호출을 생략합니다. 씽크풀은 당일 목록만 주므로 과거 일자 재실행은 지정일이 아닌 재실행일 자 중복 신호를 만듭니다.

Android 쪽에서는 `StatusActivity` 의 수동 수집 버튼이 라씨 SMS 폴백을 업로드하던 경로를 막았습니다. `SmsReceiver` 는 이미 라씨를 건너뛰는데 이곳에만 가드가 없어, 가격 `NULL` 행이 먼저 생기면 `upsert_signals_bulk` 의 `ON CONFLICT` 규칙상 서버 수집 가격이 영구히 채워지지 않았습니다.

## 11. 리스크

Thinkpool이 목록 API에 인증을 걸면 수집이 끊깁니다. 그때는 SMS 폴백(`is_fallback=true`, 가격 없음)만 남으므로, `collector_heartbeats`의 `thinkpool-api` 상태와 당일 라씨 건수로 조기에 감지해야 합니다. 접근성 코드를 삭제하지 않고 비활성화만 하는 이유가 이 복구 여지를 남기기 위해서입니다.
