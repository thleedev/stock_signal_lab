# DashboardStock

주식 대시보드 서비스 — Next.js 웹앱 + Android SMS 수집기 + Supabase 백엔드

## 빌드 & 테스트

```bash
cd web && npm run dev       # 개발 서버 (Next.js 16)
cd web && npm run build     # 프로덕션 빌드
cd web && npm run test      # Vitest 단위 테스트
cd web && npm run lint      # ESLint
```

## 프로젝트 구조

```
web/                         # Next.js 16 + React 19 프론트엔드
  src/app/                   # App Router 페이지 (dashboard, market, stocks, signals, portfolio 등)
  src/app/api/v1/            # API 라우트 (17개 도메인)
  src/components/            # UI 컴포넌트 (charts, layout, common 등)
  src/lib/                   # 서비스 로직 (supabase, ai, strategy-engine 등)
  src/types/                 # TypeScript 타입 정의
android-collector/           # Kotlin Android SMS 수집기 앱
supabase/migrations/         # Supabase DB 마이그레이션 (SQL)
```

## 코드 규칙

- **언어**: 모든 커뮤니케이션·주석·커밋 메시지는 한국어
- **Supabase 클라이언트**: 서버(API Route)는 `createServiceClient()`, 클라이언트는 `getSupabase()` 사용
- **API 라우트**: `/api/v1/` 하위에 생성, `verifyCollectorKey`로 인증
- **경로 별칭**: `@/` → `web/src/`
- **스타일**: Tailwind CSS v4
- **테스트**: Vitest, `src/**/*.test.ts` 패턴
- **디자인 토큰**: `.claude/steering/design-tokens.md` 참조 — UI 코드 작성 시 필수 준수
