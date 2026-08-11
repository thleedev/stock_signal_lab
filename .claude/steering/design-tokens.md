# 디자인 토큰 규칙

UI 코드 작성·수정 시 반드시 이 규칙을 따른다.

## 색상

CSS 변수를 사용한다. 하드코딩 금지.

| 용도 | 변수 | 값 |
|------|------|-----|
| 배경 | `var(--background)` | #0b0f1a |
| 전경 | `var(--foreground)` | #e2e8f0 |
| 카드 | `var(--card)` | #111827 |
| 카드 호버 | `var(--card-hover)` | #1a2236 |
| 테두리 | `var(--border)` | #1e293b |
| 보조 텍스트 | `var(--muted)` | #94a3b8 |
| 강조 | `var(--accent)` | #6366f1 |
| 성공 | `var(--success)` | #10b981 |
| 위험 | `var(--danger)` | #ef4444 |
| 경고 | `var(--warning)` | #f59e0b |
| 라씨 | `var(--lassi)` | #ef4444 |
| 스톡봇 | `var(--stockbot)` | #22c55e |
| 퀀트 | `var(--quant)` | #3b82f6 |
| 매수 | `var(--buy)` | #ef4444 |
| 매도 | `var(--sell)` | #3b82f6 |

## 간격

- 섹션 간격: `var(--section-gap)` 을 쓰는 `.section-gap` 클래스 또는 `PageLayout` 사용
  - 값은 화면 폭에 따라 자동으로 바뀝니다. 모바일 1rem, `md` 이상 1.5rem, `xl` 이상 2rem
  - 고정값 `space-y-6` 을 섹션 간격으로 쓰지 않습니다. 브레이크포인트 대응이 사라집니다
- 카드 패딩: `p-4` (기본) 또는 `p-8` (빈 상태 전용) — **p-5, p-6 사용 금지**

## 카드

- 기본 클래스: `.card` (globals.css에 정의됨)
- hover 효과: `hover:bg-[var(--card-hover)]` — **hover:brightness, hover:opacity 사용 금지**
- 라운드: `rounded-xl` (12px)

## 타이포그래피

- 페이지 타이틀: `text-xl md:text-2xl font-bold`
- 섹션 타이틀: `text-lg font-semibold`
- 본문: `text-sm`

## 소스/시그널 표시

- 소스 색상·라벨: `signal-constants.ts`의 `SOURCE_COLORS`, `SOURCE_LABELS` 사용 — **인라인 재정의 금지**
- 시그널 색상·라벨: `signal-constants.ts`의 `SIGNAL_COLORS`, `SIGNAL_TYPE_LABELS` 사용
- 공통 컴포넌트가 있으면 `SourceBadge`, `SignalBadge` 사용

## 모바일 반응형

목록을 보여주는 화면은 `web/src/components/ui/StackedList.tsx`를 씁니다. 좁은 화면에서
카드를, 넓은 화면에서 기존 테이블을 보여주는 컴포넌트입니다. `hidden md:table-cell` 같은
컬럼 숨김 패턴만으로 반응형을 처리하지 않습니다. 컬럼을 숨기기만 하고 대체 접근 경로를
주지 않으면 그 폭에서 정보가 사라집니다. 실제로 375px에서 `/stocks`는 컬럼 11개 중 4개만,
`/my-portfolio`는 10개 중 5개만 보이던 결함이 있었습니다.

`StackedList`의 `breakpoint` prop은 그 테이블에서 가장 늦게(가장 넓은 폭에서) 나타나는
컬럼의 브레이크포인트와 맞춥니다. 이 항목이 특히 중요합니다. 예를 들어 테이블의 마지막
컬럼이 `lg:table-cell`로 나타나는데 `StackedList`를 기본값 `md`로 두면, `md`~`lg` 사이
폭에서 카드도 사라지고 테이블 컬럼도 아직 나타나지 않아 정보가 보이지 않는 구간이
생깁니다. 이 어긋남은 이번 사이클에서 두 번 발생했습니다. 카드-테이블 전환 지점(빈 상태
문구의 표시 조건 포함)과 테이블의 마지막 컬럼 표시 지점을 항상 같은 브레이크포인트로
맞춥니다.

필수 컬럼(이름, 현재가, 등락률)은 카드 윗줄에 항상 표시합니다. 보조 컬럼은 카드 아랫줄에
배치해 테이블과 마찬가지로 모두 접근 가능하게 합니다.
