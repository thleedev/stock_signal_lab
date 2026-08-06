import { createServiceClient } from "@/lib/supabase";
import { PageLayout, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CollectorPage() {
  const supabase = createServiceClient();

  // 수집기 heartbeat 조회 — 기기별 최신 1건 뷰(078)
  // 행수 제한으로 읽으면 하트비트가 잦은 기기가 나머지를 밀어내므로 뷰로 조회합니다.
  const { data: heartbeats } = await supabase
    .from("collector_devices_latest")
    .select("*")
    .order("timestamp", { ascending: false });

  const devices = (heartbeats || []).map((hb) => {
    const lastSeen = new Date(hb.timestamp);
    const diffMs = Date.now() - lastSeen.getTime();
    // thinkpool-api 는 장중 15분 간격으로 하트비트를 남기므로 임계가 10분이면 항상 오프라인으로 보입니다.
    const isOnline = diffMs < 20 * 60 * 1000;
    const minutesAgo = Math.floor(diffMs / 60000);

    return {
      device_id: hb.device_id as string,
      status: isOnline ? "online" : "offline",
      last_seen: hb.timestamp as string,
      last_signal: hb.last_signal as string | null,
      // 수집기가 보낸 status 를 그대로 살립니다. error_message 는 정상 실행의 요약 문구로도
      // 쓰이므로(예: 알파캐치 "신호 0건, 보유만 수집"), 존재만으로 오류 표시를 하면 오탐입니다.
      last_status: (hb.status as string | null) ?? null,
      error_message: hb.error_message as string | null,
      minutes_ago: minutesAgo,
    };
  });

  // 최근 수신 로그 (최근 신호 10건)
  const { data: recentSignals } = await supabase
    .from("signals")
    .select("id, timestamp, source, name, symbol, signal_type")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <PageLayout>
      <PageHeader title="수집기 상태" subtitle="주식 신호 수집기 연결 상태" />

      {/* 기기 상태 카드 */}
      {devices.length === 0 ? (
        <div className="card p-4 sm:p-8 text-center text-sm text-[var(--muted)]">
          등록된 수집기가 없습니다. 주식 신호 수집기 앱을 설치하고 실행해주세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {devices.map((d) => (
            <div
              key={d.device_id}
              className="card p-4"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-3 h-3 rounded-full ${
                    d.status === "online" ? "bg-green-500" : "bg-gray-600"
                  }`}
                />
                <span className="font-medium">{d.device_id}</span>
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
              <div className="text-sm text-[var(--muted)] space-y-1">
                <div>
                  마지막 응답:{" "}
                  {d.minutes_ago < 1
                    ? "방금 전"
                    : d.minutes_ago < 60
                      ? `${d.minutes_ago}분 전`
                      : `${Math.floor(d.minutes_ago / 60)}시간 ${d.minutes_ago % 60}분 전`}
                </div>
                <div className="text-xs">
                  {new Date(d.last_seen).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                </div>
                {d.error_message &&
                  (d.last_status === "error" ? (
                    <div className="text-xs text-red-500 mt-1">오류: {d.error_message}</div>
                  ) : (
                    <div className="text-xs mt-1">{d.error_message}</div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 최근 수신 로그 */}
      <div className="card">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold">최근 수신 로그</h2>
        </div>
        {(recentSignals || []).length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">
            수신된 신호가 없습니다
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {(recentSignals || []).map((s: Record<string, string>) => (
              <div key={s.id} className="px-3 sm:px-4 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-3 text-xs sm:text-sm flex-wrap">
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    ["BUY", "BUY_FORECAST"].includes(s.signal_type)
                      ? "bg-red-900/30 text-red-400"
                      : "bg-blue-900/30 text-blue-400"
                  }`}
                >
                  {s.signal_type}
                </span>
                <span className="text-xs text-[var(--muted)]">{s.source}</span>
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-[var(--muted)]">{s.symbol}</span>
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {new Date(s.timestamp).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
