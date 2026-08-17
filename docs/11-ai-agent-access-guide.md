# 외부 AI 에이전트 데이터 접근 가이드

> Claude · Gemini · Grok · Cursor · ChatGPT 등 외부 AI가 DashboardStock 데이터를 조회할 때 쓰는 가이드입니다.  
> 기준: HTTP REST API (`/api/v1/*`). DB 직접 접속은 권장하지 않습니다.  
> 상세 엔드포인트 스펙: [04-api-reference.md](04-api-reference.md)

---

## 1. 한 줄 요약

DashboardStock은 **공개 HTTP REST API**로 조회합니다.  
에이전트는 배포된 웹앱의 `/api/v1/*`에 `GET` 요청을 보내고 JSON을 파싱하면 됩니다.  
별도 로그인·OAuth·에이전트 전용 키는 **없습니다** (조회 기준).

```
[Claude / Gemini / Grok / Cursor 등]
        │  HTTPS GET
        ▼
https://{BASE_URL}/api/v1/...
        │  service role로 Supabase 조회
        ▼
     PostgreSQL (signals, stock_cache, …)
```

---

## 2. 사전 준비

### 2.1 Base URL

| 환경 | URL 예시 |
|------|----------|
| 프로덕션 (Vercel) | `https://{프로젝트}.vercel.app` 또는 커스텀 도메인 |
| 로컬 | `http://localhost:3000` |

문서·프롬프트에서는 아래처럼 플레이스홀더를 씁니다.

```text
BASE_URL = https://YOUR-DEPLOYMENT.example.com
```

실제 값은 배포 후 Vercel 대시보드 또는 본인이 쓰는 도메인으로 바꿉니다.

### 2.2 공통 규칙

| 항목 | 내용 |
|------|------|
| 프로토콜 | HTTPS (로컬만 HTTP) |
| 형식 | JSON request/response |
| 문자 인코딩 | UTF-8 |
| 시간대 | 신호·일자는 **KST(UTC+9)** 기준이 많음 |
| 종목코드 | 6자리 문자열 (`005930`, `000660`) |
| 페이지네이션 | 엔드포인트마다 `limit`/`offset` 또는 `page`/`limit` |

### 2.3 인증 (조회 vs 쓰기)

| 작업 | 인증 | 비고 |
|------|------|------|
| **조회 (GET 대부분)** | **불필요** | 에이전트 기본 경로 |
| 신호 일괄 수신 POST | `x-device-key: {COLLECTOR_API_KEY}` | 수집기 전용. 에이전트 금지 권장 |
| 백업·배치·일부 cron | `Authorization: Bearer {CRON_SECRET}` | 운영 전용. 에이전트 금지 권장 |
| 일부 쓰기 API | 무인증 | 개인 서비스 전제. **에이전트는 읽기만** 할 것 |

**에이전트 규칙 (필수)**

1. `GET` 조회만 사용합니다.  
2. `POST`/`PUT`/`PATCH`/`DELETE`는 호출하지 않습니다.  
3. `COLLECTOR_API_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`를 프롬프트·도구 설정에 넣지 않습니다.  
4. Supabase URL/anon·service 키로 DB를 직접 치지 않습니다.

---

## 3. 도메인 용어 (에이전트가 알아야 할 값)

### 3.1 신호 소스 (`source`)

| 값 | 의미 |
|----|------|
| `lassi` | 라씨 매매신호 |
| `stockbot` | 스톡봇 |
| `quant` | 퀀트 + 알파캐치 (동일 source) |
| `prizm` | 프리즘 인사이트 |

### 3.2 신호 타입 (`signal_type`)

| 값 | 의미 |
|----|------|
| `BUY` | 매수 |
| `SELL` | 매도 |
| `BUY_FORECAST` | 매수 예정 (quant) |
| `SELL_COMPLETE` | 매도 완료 (quant) |

### 3.3 가상매매 실행 방식 (`execution_type`)

| 값 | 의미 |
|----|------|
| `lump` | 일시 매수 (기본) |
| `split` | 분할 매수 |

### 3.4 AI 추천 모델 (`model`)

| 값 | 의미 |
|----|------|
| `standard` | 표준 추천 (기본) |
| `short_term` | 단기 추천 |

---

## 4. 권장 엔드포인트 치트시트

에이전트가 **자주 쓰면 되는 읽기 전용** 목록입니다.  
전체 목록은 [04-api-reference.md](04-api-reference.md)를 봅니다.

### 4.1 오늘의 브리핑 (가장 많이 씀)

| 목적 | Method | Path | 주요 쿼리 |
|------|--------|------|-----------|
| 오늘 신호 전체 | GET | `/api/v1/signals/today` | 없음 |
| 시황·위험 지표 | GET | `/api/v1/market-indicators` | 없음 |
| 핫 테마 Top 10 | GET | `/api/v1/hot-themes` | 없음 |
| AI 추천 | GET | `/api/v1/ai-recommendations` | `model`, `limit`, `date` |
| 종목 랭킹 | GET | `/api/v1/stock-ranking` | `limit`, `style`, `market` |

### 4.2 신호·종목 조사

| 목적 | Method | Path | 주요 쿼리 |
|------|--------|------|-----------|
| 신호 목록 | GET | `/api/v1/signals` | `source`, `symbol`, `date`, `signal_type`, `limit`, `offset` |
| 종목 검색·목록 | GET | `/api/v1/stocks` | `q`, `market`, `page`, `limit`, `hasSignal`, `withSignals` |
| 종목 상세 | GET | `/api/v1/stock` | **`symbol`(필수)**, `period` |
| 일봉 | GET | `/api/v1/stock/{symbol}/daily-prices` | 경로에 symbol |
| 실시간 시세 | GET | `/api/v1/stocks/{symbol}/realtime` | 경로에 symbol |
| 재무 메트릭 | GET | `/api/v1/stock/{symbol}/metrics` | 경로에 symbol |
| 체크리스트 분석 | GET | `/api/v1/stock-analysis` | 문서·구현 파라미터 따름 |

### 4.3 포트·성과

| 목적 | Method | Path | 주요 쿼리 |
|------|--------|------|-----------|
| 가상매매 포트 | GET | `/api/v1/portfolio` | `source`, `execution_type` |
| 전략 성과 | GET | `/api/v1/performance` | `source`, `period` (`7d`/`30d`/`90d`/`all`) |
| 사용자 보유 | GET | `/api/v1/user-portfolio/holdings` | `portfolio_id` (선택) |
| 사용자 포트 목록 | GET | `/api/v1/user-portfolio` | — |
| 알파캐치 보유 조회 | GET | `/api/v1/holdings/alphacatch` | — |

### 4.4 운영 상태 (선택)

| 목적 | Method | Path |
|------|--------|------|
| 수집기 온라인 여부 | GET | `/api/v1/collector/status` |
| 배치 진행 상태 | GET | `/api/v1/batch-runs/status` |

---

## 5. 호출 예시

### 5.1 curl

```bash
export BASE_URL="https://YOUR-DEPLOYMENT.example.com"

# 오늘 신호
curl -sS "$BASE_URL/api/v1/signals/today" | jq .

# 특정 소스·날짜 신호
curl -sS "$BASE_URL/api/v1/signals?source=lassi&date=2026-07-22&limit=50" | jq .

# 종목 검색
curl -sS "$BASE_URL/api/v1/stocks?q=%EC%82%BC%EC%84%B1&limit=20" | jq .

# 종목 상세 (삼성전자)
curl -sS "$BASE_URL/api/v1/stock?symbol=005930&period=30d" | jq .

# AI 추천 (표준, 5종)
curl -sS "$BASE_URL/api/v1/ai-recommendations?model=standard&limit=5" | jq .

# 랭킹 Top 30
curl -sS "$BASE_URL/api/v1/stock-ranking?limit=30&style=balanced" | jq .

# 시황
curl -sS "$BASE_URL/api/v1/market-indicators" | jq .

# 가상매매 성과 30일
curl -sS "$BASE_URL/api/v1/performance?period=30d" | jq .
```

### 5.2 JavaScript / TypeScript (fetch)

```ts
const BASE_URL = process.env.DASHBOARDSTOCK_BASE_URL!;

async function getJson<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${url.pathname}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// 사용
const today = await getJson('/api/v1/signals/today');
const stock = await getJson('/api/v1/stock', { symbol: '005930', period: '30d' });
const ranking = await getJson('/api/v1/stock-ranking', { limit: 20, style: 'balanced' });
```

### 5.3 Python

```python
import os
import requests

BASE_URL = os.environ["DASHBOARDSTOCK_BASE_URL"].rstrip("/")

def get(path: str, **params):
    r = requests.get(f"{BASE_URL}{path}", params=params, timeout=30)
    r.raise_for_status()
    return r.json()

today = get("/api/v1/signals/today")
signals = get("/api/v1/signals", source="lassi", limit=50)
stock = get("/api/v1/stock", symbol="005930", period="30d")
```

### 5.4 응답 형태 참고

**오늘 신호** (`/api/v1/signals/today`)

```json
{
  "date": "2026-07-22",
  "signals": {
    "lassi": [ /* signal 객체 배열 */ ],
    "stockbot": [],
    "quant": [],
    "prizm": []
  },
  "counts": {
    "lassi": { "total": 12, "buy": 8, "sell": 4 },
    "stockbot": { "total": 0, "buy": 0, "sell": 0 },
    "quant": { "total": 3, "buy": 2, "sell": 1 },
    "prizm": { "total": 1, "buy": 1, "sell": 0 }
  },
  "total": 16
}
```

**신호 목록** (`/api/v1/signals`)

```json
{
  "signals": [ /* ... */ ],
  "total": 120,
  "limit": 50,
  "offset": 0
}
```

**종목 상세** (`/api/v1/stock?symbol=005930`)

```json
{
  "symbol": "005930",
  "prices": [ /* daily_prices */ ],
  "signals": [ /* 최근 신호 */ ],
  "trades": [ /* virtual_trades */ ]
}
```

오류 시 대체로:

```json
{ "error": "메시지" }
```

HTTP 상태: `400`(파라미터 오류), `401`(쓰기·운영 인증 실패), `500`(서버/DB).

---

## 6. 에이전트 워크플로 예시

### 6.1 「오늘 뭐 봤어?」 브리핑

1. `GET /api/v1/signals/today`  
2. `GET /api/v1/market-indicators`  
3. `GET /api/v1/hot-themes`  
4. `GET /api/v1/ai-recommendations?model=standard&limit=5`  
5. 소스별 매수·매도 건수, 시황 점수, 테마, 추천 종목을 한국어로 요약

### 6.2 「이 종목 어때?」 종목 조사

1. 이름이 오면 `GET /api/v1/stocks?q={이름}` 으로 `symbol` 확정  
2. `GET /api/v1/stock?symbol={code}&period=30d`  
3. `GET /api/v1/stocks/{code}/realtime` (필요 시)  
4. `GET /api/v1/stock-analysis?…` 또는 랭킹에서 `symbol` 필터  
5. 신호 이력·가격·점수·리스크를 근거와 함께 정리

### 6.3 「어떤 소스가 잘 나가?」 성과 비교

1. `GET /api/v1/performance?period=30d`  
2. 필요 시 `source=lassi|stockbot|quant` 로 쪼개 조회  
3. `GET /api/v1/portfolio` 로 현재 자산·보유 수 확인

### 6.4 호출 절약 팁

| 팁 | 이유 |
|----|------|
| 먼저 `/signals/today` | 하루치가 소스별로 묶여 한 번에 옴 |
| `limit`을 작게 | 토큰·응답 크기 절약 (신호 기본 50, 최대 200) |
| 종목 조사 시 symbol 확정 후 상세만 | 전량 목록 불필요 |
| 캐시 헤더 존중 | 일부 API는 CDN `s-maxage` 10~300초 |

---

## 7. 제품별 설정 방법

아래는 각 제품에 **이 가이드 + Base URL**을 넣는 방법입니다.  
UI 메뉴 이름은 제품 업데이트에 따라 달라질 수 있습니다.

### 7.1 Claude (claude.ai / Claude Code / Projects)

**Projects / Custom Instructions**

1. 프로젝트 또는 커스텀 인스트럭션에 아래 시스템 프롬프트(§8)를 붙입니다.  
2. `BASE_URL`을 실제 값으로 바꿉니다.  
3. 웹 검색·도구가 있으면 “DashboardStock API만 GET으로 호출”이라고 명시합니다.

**Claude Code / API + 도구**

- HTTP 도구(또는 bash `curl`)에 `BASE_URL`만 환경변수로 주입합니다.  
- 도구 스키마 예:

```json
{
  "name": "dashboardstock_get",
  "description": "DashboardStock 읽기 전용 API. path는 /api/v1/ 로 시작. GET only.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "예: /api/v1/signals/today" },
      "query": {
        "type": "object",
        "additionalProperties": { "type": "string" },
        "description": "쿼리 파라미터"
      }
    },
    "required": ["path"]
  }
}
```

### 7.2 Gemini (Gemini app · Gems · API)

**Gems / 시스템 지시**

1. Gem 만들 때 지시문에 §8 프롬프트를 넣습니다.  
2. Base URL을 지시문에 하드코딩하거나, 사용자가 대화 시작 시 제공하게 합니다.  
3. URL 컨텍스트·코드 실행이 있으면 `curl`/`requests`로 GET만 허용합니다.

**Google AI Studio / API**

- Function calling으로 §7.1과 동일한 `dashboardstock_get` 도구를 등록합니다.  
- 구현체는 사용자 서버 또는 로컬 프록시에서 `fetch(BASE_URL + path)` 로 처리합니다.

### 7.3 Grok (xAI / grok.com)

1. 커스텀 인스트럭션 또는 대화 첫 메시지에 §8 + `BASE_URL`을 넣습니다.  
2. 브라우저·도구 접근이 되는 환경에서는 동일하게 GET만 호출합니다.  
3. Grok Build / CLI 에서는 이 저장소의 문서 경로를 컨텍스트로 주고, `curl`로 검증합니다.

### 7.4 ChatGPT (Custom GPT · Actions)

OpenAPI Action 초안 예 (읽기 전용 일부):

```yaml
openapi: 3.1.0
info:
  title: DashboardStock Read API
  version: "1.0"
servers:
  - url: https://YOUR-DEPLOYMENT.example.com
paths:
  /api/v1/signals/today:
    get:
      operationId: getTodaySignals
      summary: 오늘 신호 (소스별 그룹)
      responses:
        "200":
          description: OK
  /api/v1/signals:
    get:
      operationId: listSignals
      parameters:
        - name: source
          in: query
          schema: { type: string, enum: [lassi, stockbot, quant, prizm] }
        - name: symbol
          in: query
          schema: { type: string }
        - name: date
          in: query
          schema: { type: string, description: "YYYY-MM-DD" }
        - name: signal_type
          in: query
          schema: { type: string }
        - name: limit
          in: query
          schema: { type: integer, default: 50, maximum: 200 }
        - name: offset
          in: query
          schema: { type: integer, default: 0 }
      responses:
        "200":
          description: OK
  /api/v1/stock:
    get:
      operationId: getStockDetail
      parameters:
        - name: symbol
          in: query
          required: true
          schema: { type: string }
        - name: period
          in: query
          schema: { type: string, default: 30d }
      responses:
        "200":
          description: OK
  /api/v1/ai-recommendations:
    get:
      operationId: getAiRecommendations
      parameters:
        - name: model
          in: query
          schema: { type: string, enum: [standard, short_term], default: standard }
        - name: limit
          in: query
          schema: { type: integer, default: 5 }
      responses:
        "200":
          description: OK
  /api/v1/stock-ranking:
    get:
      operationId: getStockRanking
      parameters:
        - name: limit
          in: query
          schema: { type: integer, default: 50 }
        - name: style
          in: query
          schema: { type: string, default: balanced }
        - name: market
          in: query
          schema: { type: string, default: all }
      responses:
        "200":
          description: OK
  /api/v1/market-indicators:
    get:
      operationId: getMarketIndicators
      responses:
        "200":
          description: OK
  /api/v1/performance:
    get:
      operationId: getPerformance
      parameters:
        - name: period
          in: query
          schema: { type: string, default: 30d }
        - name: source
          in: query
          schema: { type: string }
      responses:
        "200":
          description: OK
  /api/v1/portfolio:
    get:
      operationId: getPortfolio
      parameters:
        - name: source
          in: query
          schema: { type: string }
        - name: execution_type
          in: query
          schema: { type: string, enum: [lump, split], default: lump }
      responses:
        "200":
          description: OK
  /api/v1/hot-themes:
    get:
      operationId: getHotThemes
      responses:
        "200":
          description: OK
```

Authentication: **None** (조회 전용 Actions).  
쓰기·운영 엔드포인트는 Action에 넣지 않습니다.

### 7.5 Cursor / 로컬 코딩 에이전트

1. 이 문서 경로를 규칙·컨텍스트에 포함: `docs/11-ai-agent-access-guide.md`  
2. `.env` 또는 셸에 `DASHBOARDSTOCK_BASE_URL` 설정  
3. 에이전트에게 “데이터는 REST GET으로만, 마이그레이션·service key 사용 금지”를 명시

### 7.6 MCP 서버를 직접 둘 때 (선택)

저장소에 공식 MCP는 없습니다. 필요하면 얇은 래퍼를 둡니다.

| 도구 이름 | 내부 호출 |
|-----------|-----------|
| `get_today_signals` | `GET /api/v1/signals/today` |
| `list_signals` | `GET /api/v1/signals` |
| `get_stock` | `GET /api/v1/stock` |
| `get_ranking` | `GET /api/v1/stock-ranking` |
| `get_market` | `GET /api/v1/market-indicators` |
| `get_recommendations` | `GET /api/v1/ai-recommendations` |
| `get_performance` | `GET /api/v1/performance` |

모든 도구는 **GET 전용**, 환경변수 `DASHBOARDSTOCK_BASE_URL`만 사용합니다.

---

## 8. 복붙용 시스템 프롬프트

아래 블록을 Claude Project / Gem / Custom GPT / Grok 인스트럭션에 그대로 넣습니다.  
`YOUR-DEPLOYMENT`만 바꿉니다.

```text
당신은 DashboardStock 투자 데이터 어시스턴트입니다.
데이터는 오직 아래 REST API의 GET 요청으로만 가져옵니다.

BASE_URL = https://YOUR-DEPLOYMENT.example.com

규칙:
1. GET /api/v1/* 만 호출한다. POST/PUT/PATCH/DELETE 금지.
2. API 키, Supabase 키, CRON_SECRET, 컬렉터 키를 요청하거나 사용하지 않는다.
3. DB·SQL 직접 접근을 하지 않는다.
4. 종목코드는 6자리(예: 005930)를 쓴다. 이름만 알면 먼저 /api/v1/stocks?q= 로 검색한다.
5. 날짜·“오늘”은 한국시간(KST) 기준이다.
6. source: lassi | stockbot | quant | prizm
7. signal_type: BUY | SELL | BUY_FORECAST | SELL_COMPLETE
8. 답변은 한국어. 수치·종목코드·출처 API 경로를 근거로 남긴다.
9. 투자 조언이 아니라 데이터 요약·비교임을 명시한다.

자주 쓰는 엔드포인트:
- GET {BASE_URL}/api/v1/signals/today
- GET {BASE_URL}/api/v1/signals?source=&symbol=&date=&signal_type=&limit=&offset=
- GET {BASE_URL}/api/v1/stocks?q=&market=&page=&limit=&hasSignal=
- GET {BASE_URL}/api/v1/stock?symbol=&period=30d
- GET {BASE_URL}/api/v1/stock-ranking?limit=50&style=balanced&market=all
- GET {BASE_URL}/api/v1/ai-recommendations?model=standard&limit=5
- GET {BASE_URL}/api/v1/market-indicators
- GET {BASE_URL}/api/v1/hot-themes
- GET {BASE_URL}/api/v1/portfolio?source=&execution_type=lump
- GET {BASE_URL}/api/v1/performance?period=30d&source=
- GET {BASE_URL}/api/v1/user-portfolio/holdings
- GET {BASE_URL}/api/v1/collector/status

브리핑 요청 시 호출 순서:
1) signals/today 2) market-indicators 3) hot-themes 4) ai-recommendations
종목 질문 시: stocks 검색 → stock 상세 → 필요 시 ranking/realtime
```

---

## 9. 보안·운영 주의

1. **공개 배포 URL이면 조회 API가 인터넷에 노출**됩니다. 개인 서비스 전제 설계입니다.  
2. 쓰기 API 중 일부가 무인증입니다. 에이전트 프롬프트에서 **쓰기를 명시적으로 금지**합니다.  
3. Vercel 배포를 외부 공유할 경우, 장기적으로는  
   - 읽기 전용 에이전트 키,  
   - IP 제한,  
   - 또는 조회 전용 게이트웨이  
   를 두는 편이 안전합니다. (현재 미구현)  
4. `SERVICE_ROLE` / DB 비밀번호는 CI·서버에만 두고 에이전트 컨텍스트에 넣지 않습니다.  
5. 응답 전체를 그대로 모델 컨텍스트에 넣으면 토큰이 큽니다. `limit`을 줄이고 필요한 필드만 요약합니다.

---

## 10. 빠른 점검 체크리스트

에이전트 연동 전 로컬 또는 배포 URL에서 확인합니다.

```bash
BASE_URL=https://YOUR-DEPLOYMENT.example.com

curl -sS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/v1/signals/today"
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/v1/market-indicators"
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/v1/stock?symbol=005930"
```

기대: 모두 `200`.  
`404`면 경로·배포 확인, `500`이면 서버 로그·Supabase 연결 확인.

---

## 11. 관련 문서

| 문서 | 용도 |
|------|------|
| [01-overview.md](01-overview.md) | 서비스·인증 구조 전체 |
| [04-api-reference.md](04-api-reference.md) | 전 엔드포인트 인벤토리 |
| [03-database.md](03-database.md) | 테이블·스키마 (DB 직접 접근 시 참고만) |
| [07-scoring.md](07-scoring.md) | 점수·추천 해석 |

---

## 12. 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-08-04 | 최초 작성 — 외부 AI 에이전트 REST 조회 가이드 |
