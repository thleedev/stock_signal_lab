import { createServiceClient } from "@/lib/supabase";
import { PageLayout, PageHeader } from "@/components/ui";
import { PORTFOLIO_CONFIG } from "@/lib/strategy-engine";
import FavoritesManager from "./favorites-manager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = createServiceClient();

  // 알림 규칙 조회
  const { data: notificationRules } = await supabase
    .from("notification_rules")
    .select("*")
    .order("created_at", { ascending: false });

  // 즐겨찾기 종목 조회 + 그룹 데이터 로드
  const [{ data: favorites }, { data: groupRows }, { data: gsRows }] = await Promise.all([
    supabase.from("favorite_stocks").select("*").order("added_at", { ascending: false }),
    supabase.from("watchlist_groups").select("*").order("sort_order"),
    supabase.from("watchlist_group_stocks").select("group_id, symbol"),
  ]);

  const symbolGroupIds: Record<string, string[]> = {};
  for (const r of gsRows ?? []) {
    if (!symbolGroupIds[r.symbol]) symbolGroupIds[r.symbol] = [];
    symbolGroupIds[r.symbol].push(r.group_id);
  }

  // 수집기 heartbeat 조회
  const { data: heartbeats } = await supabase
    .from("collector_heartbeats")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(20);

  // 기기별 최신 상태
  const deviceMap = new Map<string, (typeof heartbeats extends (infer T)[] | null ? T : never)>();
  for (const hb of heartbeats || []) {
    if (!deviceMap.has(hb.device_id)) {
      deviceMap.set(hb.device_id, hb);
    }
  }

  const devices = Array.from(deviceMap.values()).map((hb) => {
    const lastSeen = new Date(hb.timestamp);
    const diffMs = Date.now() - lastSeen.getTime();
    const isOnline = diffMs < 10 * 60 * 1000;
    const minutesAgo = Math.floor(diffMs / 60000);

    return {
      device_id: hb.device_id as string,
      status: isOnline ? "online" : "offline",
      last_seen: hb.timestamp as string,
      minutes_ago: minutesAgo,
    };
  });

  return (
    <PageLayout>
      <PageHeader title="설정" subtitle="시스템 설정 및 정보" />

      {/* 1. 포트폴리오 설정 */}
      <section>
        <h2 className="text-lg font-semibold mb-3">포트폴리오 설정</h2>
        <div className="card p-3 sm:p-5">
          <p className="text-xs text-[var(--muted)] mb-4">
            전략 엔진 기본 설정 (PORTFOLIO_CONFIG)
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <div>
              <div className="text-xs text-[var(--muted)]">소스당 초기자본</div>
              <div className="text-base sm:text-lg font-bold mt-1 tabular-nums break-words">
                {PORTFOLIO_CONFIG.INITIAL_CASH_PER_SOURCE.toLocaleString()}원
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)]">전략당 자본</div>
              <div className="text-base sm:text-lg font-bold mt-1 tabular-nums break-words">
                {PORTFOLIO_CONFIG.CASH_PER_STRATEGY.toLocaleString()}원
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)]">최대 포지션 비율</div>
              <div className="text-base sm:text-lg font-bold mt-1 tabular-nums break-words">
                {(PORTFOLIO_CONFIG.MAX_POSITION_RATIO * 100).toFixed(0)}%
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)]">분할 횟수</div>
              <div className="text-base sm:text-lg font-bold mt-1 tabular-nums break-words">
                {PORTFOLIO_CONFIG.SPLIT_COUNT}회
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. 알림 설정 */}
      <section>
        <h2 className="text-lg font-semibold mb-3">알림 설정</h2>
        <div className="card">
          {(notificationRules || []).length === 0 ? (
            <div className="p-8 text-center text-[var(--muted)]">
              등록된 알림 규칙이 없습니다
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {(notificationRules || []).map((rule: Record<string, unknown>, i: number) => (
                <div key={rule.id as string ?? i} className="px-4 py-3 flex items-center gap-3">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      rule.enabled ? "bg-green-500" : "bg-gray-600"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {rule.source_filter
                        ? `소스: ${rule.source_filter}`
                        : "전체 소스"}
                      {rule.signal_type_filter
                        ? ` / 신호: ${rule.signal_type_filter}`
                        : " / 전체 신호"}
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      rule.enabled
                        ? "bg-green-900/30 text-green-400"
                        : "bg-gray-800/30 text-gray-400"
                    }`}
                  >
                    {rule.enabled ? "활성" : "비활성"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 3. 즐겨찾기 관리 */}
      <section>
        <h2 className="text-lg font-semibold mb-3">즐겨찾기 관리</h2>
        <div className="card">
          <FavoritesManager
            favorites={(favorites || []).map((f: Record<string, string>) => ({
              symbol: f.symbol,
              name: f.name,
              added_at: f.added_at,
            }))}
            groups={groupRows ?? []}
            symbolGroupIds={symbolGroupIds}
          />
        </div>
      </section>

      {/* 4. 수집기 정보 */}
      <section>
        <h2 className="text-lg font-semibold mb-3">수집기 정보</h2>
        <div className="card">
          {devices.length === 0 ? (
            <div className="p-8 text-center text-[var(--muted)]">
              등록된 수집기가 없습니다
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {devices.map((d) => (
                <div key={d.device_id} className="px-4 py-3 flex items-center gap-3">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      d.status === "online" ? "bg-green-500" : "bg-gray-600"
                    }`}
                  />
                  <span className="text-sm font-medium">{d.device_id}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {d.minutes_ago < 1
                      ? "방금 전"
                      : d.minutes_ago < 60
                        ? `${d.minutes_ago}분 전`
                        : `${Math.floor(d.minutes_ago / 60)}시간 ${d.minutes_ago % 60}분 전`}
                  </span>
                  <span
                    className={`ml-auto text-xs px-2 py-0.5 rounded ${
                      d.status === "online"
                        ? "bg-green-900/30 text-green-400"
                        : "bg-gray-800/30 text-gray-400"
                    }`}
                  >
                    {d.status === "online" ? "온라인" : "오프라인"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 5. 데이터 백업 */}
      <section>
        <h2 className="text-lg font-semibold mb-3">데이터 백업</h2>
        <div className="card p-3 sm:p-5">
          <p className="text-sm text-[var(--muted)] mb-3">
            관심종목, 포트, 신호, 거래내역 등 핵심 데이터를 JSON 파일로 백업합니다.
          </p>
          <p className="text-xs text-[var(--muted)] mb-2">
            API: <code className="bg-[var(--background)] px-1 rounded">GET /api/v1/backup</code> (Authorization: Bearer CRON_SECRET)
          </p>
          <div className="text-xs text-[var(--muted)]">
            Cron 설정 예시: 매주 일요일 자동 백업
          </div>
        </div>
      </section>

      {/* 6. 시스템 정보 */}
      <section>
        <h2 className="text-lg font-semibold mb-3">시스템 정보</h2>
        <div className="card p-5 space-y-4">
          <div>
            <div className="text-xs text-[var(--muted)]">앱 버전</div>
            <div className="text-sm font-medium mt-0.5">DashboardStock v1.0</div>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)]">API 엔드포인트</div>
            <div className="text-sm font-mono mt-0.5 break-all">
              {process.env.NEXT_PUBLIC_SUPABASE_URL ?? "미설정"}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)] mb-2">Cron 스케줄</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded border border-[var(--border)] p-3">
                <div className="text-sm font-medium">daily-prices</div>
                <div className="text-xs text-[var(--muted)] mt-1">
                  평일 16:00 KST (가격 수집 + 리포트)
                </div>
              </div>
              <div className="rounded border border-[var(--border)] p-3">
                <div className="text-sm font-medium">stock-cache</div>
                <div className="text-xs text-[var(--muted)] mt-1">
                  평일 20:00 KST (시세 + 지표 캐시)
                </div>
              </div>
              <div className="rounded border border-[var(--border)] p-3">
                <div className="text-sm font-medium">market-indicators</div>
                <div className="text-xs text-[var(--muted)] mt-1">
                  매일 07:00 KST (시장지표 + 통계)
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
