# 알파캐치 API 조사 (접근성 대체 후보)

> 조사 시작: 2026-08-03  
> 목적: 라씨와 같이 **서버 HTTP 수집**으로 알파캐치 접근성 스크래핑을 대체할 수 있는지 판정  
> 상태: **공개 전량 API 미확보** — 영웅문 앱 트래픽 캡처가 다음 필수 단계

관련: `docs/09-lassi-api-reverse-engineering.md`, `tools/traffic-capture/RUNBOOK.md`

---

## 1. 한 줄 결론

| 항목 | 라씨 | 알파캐치 |
|------|------|----------|
| 제휴 공급사 | 씽크풀 (Thinkpool) | **르퓨쳐자산운용사** (LeFuture) |
| 공개 웹 SPA + 목록 API | 있음 (`api.thinkpool.com`) | **조사 시점 없음** |
| SMS 딥링크 `i.kiwoom.com/_…` | `_rassi` → mts/2806 | **알려진 숏링크 없음** (추정 경로 전부 홈으로 302) |
| 서버 크론 즉시 이관 | ✅ 완료 | ❌ 불가 (엔드포인트 미발견) |
| 다음 행동 | 운영·스케줄 | **영웅문 앱 mitm 캡처 (S4)** |

알파캐치는 라씨와 **같은 패턴을 가정하면 안 됩니다.**  
신호 SMS는 이미 풍부하고, **보유 종목·화면 전량**이 접근성에 묶여 있는 점이 병목입니다.

---

## 2. 현재 DashboardStock 수집 구조

| 데이터 | 채널 | 구현 |
|--------|------|------|
| 매수/매도 **신호** | SMS `[키움][알파캐치]` | `AlphaCatchSmsParser` → `source=quant` |
| 화면 매수/매도/보유 | 접근성 (영웅문 → 알파캐치 → 알파추천) | `AlphaCatchAccessibilityService` + `AlphaCatchScreenParser` |
| 보유 종목 테이블 | 화면 스크래핑 후 전체 덮어쓰기 | `alphacatch_holdings` / `PUT /api/v1/holdings/alphacatch` |

### SMS로 이미 되는 것 (서버 이관 우선순위 낮음)

```
[키움][알파캐치] 2026.04.30 매매신호
▶ 매수
1)종목명: 제일기획(030000)
- 알파스코어 / 섹터 / 변동성
진입구간 / 단기 목표가
```

- 종목코드·이름·진입구간·목표가 포함  
- Android SMS 경로가 정상이면 **신호 자체는 폰 API 없이도 수집 중**  
- 서버 API 이관의 핵심 이득은 “SMS 의존 제거”이지, 지금 깨지는 지점은 아님  

### 접근성에 묶인 것 (이 조사의 타깃)

화면 3섹션 (세로 스크롤):

1. **매수 신호** — 종목명 / 섹터 / 매수가 (화면에 코드 없을 수 있음)  
2. **매도 신호** — 종목명 / 수익률 / 매도가  
3. **보유 종목** — 종목명 / 수익률 / 종가 / 매수가 / 매수일 → `alphacatch_holdings`

보유는 종목코드가 화면 트리에 없어 **name 키**로 올리는 한계가 문서화되어 있습니다 (`02-android-collector.md`).

---

## 3. 공개 단서 (2026-08-03)

### 3.1 공급사

- 키움 로보마켓 소개: `https://www.kiwoom.com/inv/roboMarket/AX/introduce`  
- 문구: 데이터 기반 알고리즘 매수·매도 시그널, 제휴 **르퓨쳐자산운용사**  
- 페이지 내 외부 링크: `https://lefuture.co.kr/home/pat?nation=KR&home=none` → **404**  
- `lefuture.co.kr` 본체: WordPress **홍보 사이트** (신호 JSON SPA 아님)  
- `api.lefuture.co.kr` / `m.lefuture.co.kr`: 인증서 호스트 불일치로 공개 접근 실패  

→ 씽크풀 `m.thinkpool.com` + `api.thinkpool.com` 구조와 **다름**.

### 3.2 키움 숏링크

| 경로 | Location |
|------|----------|
| `_rassi` | `invest.kiwoom.com/inv/mts/2806` (라씨) |
| `_q` | `.../mts/2768` (퀀트) |
| `_stb` | `.../mts/2751` (스톡봇) |
| `_ac`, `_alpha`, `_alphacatch`, `_alc`, `_ar` 등 | `https://www.kiwoom.com/` (무의미) |

SMS 픽스처·문서에 알파캐치 전용 `i.kiwoom.com/_…` 는 없음.  
앱 메뉴 진입만 존재 (`AlphaCatchAccessibilityService` 상태머신).

### 3.3 invest.kiwoom.com `/inv/mts/{id}`

다수 화면번호가 동일한 “화면이동” 브릿지 HTML을 반환합니다.  
앱 밖에서는 **알파캐치 screen_id 를 특정할 수 없음** → 앱 내 `activityGoto` / 네트워크로 확인 필요.

---

## 4. 가설 (캡처로 검증)

| ID | 가설 | 검증 방법 |
|----|------|-----------|
| H1 | 영웅문 WebView가 `invest.kiwoom.com` 또는 키움 내부 API로 JSON 수신 | 앱 프록시, host 필터 |
| H2 | 르퓨쳐/제3 호스트로 직접 호출 (세션·토큰 포함) | `lefuture`, 비-kiwoom host |
| H3 | 네이티브 TR/소켓만 사용, HTTPS JSON 없음 | CONNECT만 증가·복호화 실패·JSON 0건 |
| H4 | 목록은 로그인 세션 필수 (라씨 공개 API와 다름) | secrets 헤더·쿠키 출현 |

H3이면 서버 크론 이관은 어렵고, SMS + 보유만 수동/OCR/접근성 폴백이 현실적입니다.

---

## 5. 트래픽 캡처 절차 (필수)

도구: `tools/traffic-capture/` (mitmproxy, 기기 SM_S948N 등)

### 5.1 시작

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
bash tools/traffic-capture/install-ca-android.sh   # CA 미설치 시
bash tools/traffic-capture/start-capture.sh alphacatch-app web
# mitmweb: http://127.0.0.1:8081
# 저장: tools/traffic-capture/out/<ts>-alphacatch-app/
```

폰: Wi‑Fi 프록시 `MacIP:8080` 또는 `127.0.0.1:8080` (adb reverse), CA 신뢰.

### 5.2 시나리오 S4 (영웅문)

| 순서 | 동작 | 목적 |
|------|------|------|
| 1 | 영웅문S 완전 종료 후 재실행·로그인 | 세션 트래픽 |
| 2 | 메뉴 → **알파캐치** 탭 | 진입 API |
| 3 | **알파추천** / 매매 신호 화면 | 목록 로드 |
| 4 | 매수·매도·보유가 보이도록 **스크롤** | 페이지네이션·추가 호출 |
| 5 | 보유 종목 1건 상세(가능 시) | 단건 API |
| 6 | (선택) 알파캐치 푸시 알림 탭 | 푸시 연동 URL |

### 5.3 성공 판정

| 결과 | 의미 | 다음 |
|------|------|------|
| JSON에 종목명·가격·보유 리스트 | **서버 이관 가능** | 스키마 매핑 → `cron/alphacatch-*` 설계 |
| 인증 헤더 + JSON | 이관 가능, 토큰 확보 필요 | secrets 이름만 문서화 (원문 커밋 금지) |
| TLS handshake fail / CONNECT only | 피닝 또는 사용자 CA 거부 | RUNBOOK 피닝 절, Frida/HTTP Toolkit 등 |
| 관심 호스트 0건 | 필터 밖 호스트 또는 프록시 미적용 | mitm.it 재확인, summary 전체 호스트 점검 |

### 5.4 검색 키워드

```text
alpha, alphacatch, 알파, holding, portfolio, recommend
lefuture, stockCode, stockName, 보유, 매수가
```

```bash
cd tools/traffic-capture/out/<session>
rg -n "alpha|holding|stockCode|lefuture|알파" index.jsonl flows/ 2>/dev/null | head -50
```

세션 종료 후:

```bash
cp tools/traffic-capture/findings-template.md \
   tools/traffic-capture/out/<session>/FINDINGS.md
# FINDINGS.md 작성 → 요약은 이 문서 §7 에 반영
```

---

## 6. 구현 분기 (캡처 이후)

### 분기 A — 공개 또는 재현 가능한 HTTP 목록 API

라씨와 동일 패턴:

1. `web/src/lib/alphacatch-*.ts` fetch + map  
2. 신호 → `upsert_signals_bulk` (`source` 정책: 지금 SMS와 맞추려면 `quant` + raw_data 구분, 또는 신규 source 논의)  
3. 보유 → 기존 `alphacatch_holdings` 덮어쓰기 API  
4. `GET/POST /api/v1/cron/alphacatch-signals` + `CRON_SECRET`  
5. Android 알파캐치 접근성 강등  

### 분기 B — 인증 필수 API

- 캡처로 토큰 발급·갱신 흐름 파악  
- 서버 환경변수에 시크릿 (자동 로그인 가능 여부 별도)  
- 불가 시 전용 폰에서만 토큰 갱신 후 서버로 전달하는 하이브리드  

### 분기 C — JSON 없음 (피닝·전용 프로토콜)

- **신호**: SMS 유지 (이미 충분)  
- **보유**: 접근성/OCR/수동 동기화 유지  
- 서버 크론 “전량 대체”는 보류  

---

## 7. 캡처 결과 로그 (채워 넣을 칸)

| 날짜 | 세션 폴더 | 복호화 | 핵심 host/path | 인증 | 비고 |
|------|-----------|--------|----------------|------|------|
| 2026-08-03 | `out/20260803-164811-alphacatch-app` | **미도달** | — | — | 프록시 `NONE` → hit 0 |
| 2026-08-03 | (동일 세션 재시도) | **앱 UI 장애** | — | — | 시스템 프록시 ON 후 로그인만 되고 **라씨·알파캐치 메뉴/화면 비표시**. WebView·로보마켓 HTTPS가 사용자 CA/프록시에 막힌 전형적 증상. 프록시 해제(`http_proxy` null)로 복구 시도. 일반 mitm으로는 영웅문 로보마켓 캡처가 어려울 수 있음 → 피닝 우회·VPN 캡처·SMS 유지 검토 |

---

## 8. 리스크·정책

1. 비공식 엔드포인트 — 변경·차단 가능  
2. 약관 — 본인 가입 범위 개인 수집 권장  
3. `source=quant` 혼재 — 알파캐치와 퀀트 SMS가 같은 source. API 이관 시 raw_data/`provider` 구분을 유지할 것  
4. 보유 종목 코드 부재 — API에 코드가 있으면 기존 name-only 한계 해소 가능  

---

## 9. 체크리스트

- [x] 공급사·공개 웹 구조 확인 (르퓨쳐 WP, 목록 API 없음)  
- [x] 숏링크·mts 브릿지 외부 프로브 (알파캐치 ID 미특정)  
- [x] SMS vs 화면 역할 분리 문서화  
- [ ] S4 영웅문 캡처 1회 이상  
- [ ] 목록/보유 JSON 또는 “불가” 판정 기록  
- [ ] 분기 A/B/C 확정 후 구현 착수  

---

## 10. 참고 코드 경로

| 경로 | 역할 |
|------|------|
| `android-collector/.../AlphaCatchSmsParser.kt` | SMS 신호 |
| `android-collector/.../AlphaCatchScreenParser.kt` | 화면 3섹션 |
| `android-collector/.../AlphaCatchAccessibilityService.kt` | 스크래핑 상태머신 |
| `web/src/app/api/v1/holdings/alphacatch/route.ts` | 보유 PUT/GET |
