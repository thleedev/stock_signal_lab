# 트래픽 캡처 런북

본인 기기·본인 계정으로 **키움/씽크풀 신호 API** 를 관찰하기 위한 절차입니다.  
목표는 접근성 스크래핑 없이 쓸 수 있는 HTTP 엔드포인트를 확정하는 것입니다.

관련 배경: `docs/09-lassi-api-reverse-engineering.md`

---

## 0. 현재 환경 (자동 확인됨)

| 항목 | 상태 |
|------|------|
| mitmproxy | 11.0.2 (`mitmdump` / `mitmweb`) |
| CA | `~/.mitmproxy/mitmproxy-ca-cert.cer` 존재 |
| adb | 36.x |
| 연결 기기 | `SM_S948N` (Android **16**) |
| 우선 전략 | **브라우저(씽크풀) 먼저 → 영웅문 앱은 피닝 가능성 높음** |

Android 7+ 에서 앱은 기본적으로 **사용자 CA를 신뢰하지 않습니다**.  
영웅문이 TLS 피닝까지 쓰면 프록시만으로는 본문이 안 보입니다. 그 경우에도:

1. Chrome 으로 `m.thinkpool.com` / `api.thinkpool.com` 은 캡처 가능 (라씨 전량 API 이미 확보)
2. 알파캐치·키움 전용 API 는 앱 복호화 또는 다른 우회가 필요

---

## 1. 한 번에 켜기

터미널 A (Mac):

```bash
cd /Users/thlee/GoogleDrive/DashboardStock

# CA 를 폰 Download 로 푸시 + 설치 안내
bash tools/traffic-capture/install-ca-android.sh

# 시나리오 이름과 함께 캡처 시작 (브라우저 UI: http://127.0.0.1:8081)
bash tools/traffic-capture/start-capture.sh lassi-browser web
```

다른 시나리오 예:

```bash
bash tools/traffic-capture/start-capture.sh alphacatch-app web
bash tools/traffic-capture/start-capture.sh kiwoom-lassi-app web
bash tools/traffic-capture/start-capture.sh thinkpool-login web
```

종료 시 `Ctrl+C` → `out/<ts>-<scenario>/summary.md` 가 갱신됩니다.

---

## 2. 폰 프록시·CA (최초 1회)

`install-ca-android.sh` 출력대로:

1. **CA 설치**: 설정 → 인증서 설치 → `mitmproxy-ca-cert.cer` (용도: **CA 인증서**)
2. **Wi‑Fi 프록시 수동**: Mac LAN IP + 포트 `8080`  
   - USB only: `127.0.0.1:8080` (`start-capture.sh` 가 `adb reverse` 설정)
3. Chrome → `http://mitm.it` 이 열리면 프록시 OK
4. Chrome → `https://api.thinkpool.com/signal/periodProfit`  
   - mitmweb 에 JSON 이 보이면 **복호화 성공**

캡처가 끝나면 프록시를 **없음**으로 되돌리세요. (인터넷 장애 예방)

---

## 3. 시나리오 체크리스트

각 시나리오마다 **새 캡처 세션**을 켜고, 끝난 뒤 `summary.md` + `findings-template.md` 사본을 채웁니다.

### S1. `lassi-browser` — 씽크풀 웹 라씨 (우선)

목적: 전량 API·로그인 후 추가 호출 확인

| # | 동작 |
|---|------|
| 1 | Chrome 시크릿 아님(쿠키 유지 가능)으로 `https://m.thinkpool.com/signal` |
| 2 | 비로그인 상태로 홈 로드 → 카운트/하이라이트 |
| 3 | `https://m.thinkpool.com/signal/buy` , `.../sell` 직접 진입 |
| 4 | (가능하면) 씽크풀 로그인 후 3 반복 |
| 5 | 종목 하나 탭 → 상세 신호 화면 |

**기대 hit**

- `api.thinkpool.com/signal/B/signalTodayBuySellList`
- `api.thinkpool.com/signal/S/signalTodayBuySellList`
- `rassiapp.thinkpool.com:47700/rassi_ext/TR_SIGNAL09`
- 로그인 시 `paidMemberChk`, 쿠키/`Authorization`

### S2. `thinkpool-login` — 인증 헤더 확보

| # | 동작 |
|---|------|
| 1 | 로그아웃 상태 캡처 시작 |
| 2 | `sign.thinkpool.com` 로그인 플로우 끝까지 |
| 3 | `/signal/my` 진입 |
| 4 | 관심종목·푸시 설정 화면이 있으면 터치 |

**기록할 것**: 쿠키 이름, `Authorization` 형태, `Secrete_Token` 유무, 만료 추정  
→ 원문은 `flows/*_secrets.json` 에만 두고 git 금지

### S3. `kiwoom-lassi-app` — 영웅문 라씨

| # | 동작 |
|---|------|
| 1 | 영웅문S 완전 종료 후 재실행 |
| 2 | 로그인(생체/비번) |
| 3 | 라씨매매신호 메뉴 진입 (또는 SMS 딥링크) |
| 4 | 매수 탭 → 스크롤 → 매도 탭 |
| 5 | 종목 상세 1회 |

**성공 시**: JSON 목록 호스트가 thinkpool 인지 kiwoom 인지만 봐도 큼  
**실패 시**: mitm 에 `TLS` / `Client TLS handshake failed` / CONNECT 만 증가 → 피닝 또는 사용자 CA 거부

### S4. `alphacatch-app` — 알파캐치 (공개 API 없음 → 앱 캡처 필수)

배경: `docs/10-alphacatch-api-investigation.md`  
공급사 르퓨쳐 공개 웹에는 Thinkpool형 목록 API가 없음. **영웅문 앱 트래픽이 유일한 경로.**

| # | 동작 |
|---|------|
| 1 | 영웅문S 완전 종료 후 재실행·로그인 |
| 2 | 메뉴 → **알파캐치** 탭 |
| 3 | **알파추천** / 매매 신호 화면 진입 |
| 4 | 매수·매도·**보유** 섹션이 보이도록 스크롤 |
| 5 | 가능하면 보유 종목 상세 1회 |
| 6 | (선택) 알파캐치 푸시 알림 탭 |

**찾을 키워드** (summary·index 검색):

```text
alpha, alphacatch, 알파, lefuture, quant, recommend, holding, portfolio, stockCode
```

**판정**

| 결과 | 다음 |
|------|------|
| 종목 JSON 확보 | `10-alphacatch` §6 분기 A/B 구현 |
| TLS/피닝만 | §6 분기 C + RUNBOOK 피닝 절 |
| hit 0 | 프록시·CA 재확인 후 재시도 |

```bash
bash tools/traffic-capture/start-capture.sh alphacatch-app web
```

### S5. `kiwoom-push` — 푸시 수신 직후 (선택)

| # | 동작 |
|---|------|
| 1 | 캡처 켠 채 라씨/알파 푸시 대기 또는 알림 재탭 |
| 2 | 알림 리스너가 스크래핑 대신 열 화면에서 네트워크 관찰 |

---

## 4. 결과물 위치

```
tools/traffic-capture/out/<YYYYMMDD-HHMMSS>-<scenario>/
  session.json
  index.jsonl          # 한 줄 요약
  summary.md           # 호스트·엔드포인트 집계
  flows/0001_GET_....json
  flows/0002_POST_....json
  flows/0002_secrets.json   # 인증 원본 (커밋 금지)
```

로컬 검색 예:

```bash
cd tools/traffic-capture/out/<session>
rg -n "signalToday|stockCode|alpha|holding|TR_" index.jsonl flows/
```

---

## 5. 피닝·복호화 실패 시

### 5.1 증상

- mitmweb 에 CONNECT 만 있고 HTTP 디테일 없음  
- 로그: `Client TLS handshake failed` / `certificate verify failed`  
- 앱만 네트워크 오류, Chrome 은 정상

### 5.2 대응 순서

| 순서 | 방법 | 난이도 | 비고 |
|------|------|--------|------|
| 1 | Chrome 씽크풀만 캡처 | 낮음 | 라씨 전량은 이미 이 경로로 충분 |
| 2 | 시스템 CA 로 승격 (Magisk / rooted) | 중 | 사용자 CA 거부 우회 |
| 3 | HTTP Toolkit Android VPN 앱 | 중 | 루트 없이 일부 앱 가능 |
| 4 | Frida + ssl-unpinning | 높음 | 개인 연구 기기 한정 |
| 5 | `adb shell` + 앱 WebView 디버깅 | 높음 | 릴리즈 앱은 보통 비활성 |

영웅문 본문이 끝까지 안 열려도, **알파캐치가 외부 도메인(HTTP JSON)** 을 쓰면 그 호스트만 따로 성공할 수 있습니다. summary 의 호스트 목록을 먼저 확인하세요.

---

## 6. 세션 후 정리 (필수)

```bash
# 폰 프록시 해제 — 설정 UI에서 "없음"
# adb reverse 해제
adb reverse --remove-all

# 민 파일 실수 커밋 방지
ls tools/traffic-capture/out/**/*secrets* 2>/dev/null
```

`findings-template.md` 를 복사해 세션 폴더에 `FINDINGS.md` 로 채웁니다.

```bash
cp tools/traffic-capture/findings-template.md \
   tools/traffic-capture/out/<session>/FINDINGS.md
```

---

## 7. 오늘 목표 정의 (완료 조건)

| 우선 | 조건 |
|------|------|
| P0 | S1 에서 B/S `signalTodayBuySellList` flow 파일 확보 (재현) |
| P1 | S2 에서 로그인 후 추가 API 유무 판정 |
| P2 | S3 복호화 성공 여부 판정 (성공 시 키움 전용 URL 목록) |
| P3 | S4 알파캐치 관련 host/path 최소 1개 확정 또는 “피닝으로 불가” 기록 |

P0~P1 만 되어도 라씨 서버 수집 구현은 진행 가능합니다.  
P3 가 알파캐치 접근성 제거의 분기점입니다.

---

## 8. 명령 치트시트

```bash
# 캡처 + 웹 UI
bash tools/traffic-capture/start-capture.sh S1-lassi web

# 터미널만 (SSH·저사양)
bash tools/traffic-capture/start-capture.sh S4-alpha dump

# 인덱스에서 종목 JSON 찾기
rg stockCode tools/traffic-capture/out -g'*.json' | head

# 프록시 없이 이미 아는 API 스모크
curl -s 'https://api.thinkpool.com/signal/B/signalTodayBuySellList' \
  -H 'Origin: https://m.thinkpool.com' | head -c 200
```
