import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * 테스트 실행 타임존 고정.
 *
 * 기본값을 UTC 로 잡는 근거는 프로덕션 런타임과 맞추기 위함입니다.
 * Vercel 서버리스 함수와 CI 러너는 TZ 가 설정되지 않아 UTC 로 동작하므로,
 * `npm test` 는 실제 배포 환경과 같은 조건에서 돌아야 합니다.
 * 고정하지 않으면 개발 머신(Asia/Seoul)과 CI(UTC)의 결과가 달라집니다.
 *
 * 외부에서 TZ 를 지정하면 그 값을 우선합니다.
 * date-utils 의 타임존 회귀는 단일 타임존으로 전부 잡히지 않으므로
 * `npm run test:tz` 가 UTC / Asia/Seoul / America/Los_Angeles 를 순회하며,
 * 그때 이 분기가 각 타임존을 워커 프로세스까지 전달합니다.
 * 자세한 내용은 src/lib/__tests__/date-utils.test.ts 상단 주석에 있습니다.
 */
const TZ = process.env.TZ || 'UTC';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules'],
    env: { TZ },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
