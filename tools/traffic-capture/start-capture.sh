#!/usr/bin/env bash
# mitmproxy 캡처 세션 시작
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT_ROOT="$ROOT/out"
SCENARIO="${1:-manual}"
MODE="${2:-web}"   # web | dump
PORT="${CAPTURE_PORT:-8080}"
CONFDIR="${MITMPROXY_CONFDIR:-$HOME/.mitmproxy}"

TS="$(date +%Y%m%d-%H%M%S)"
CAPTURE_DIR="${CAPTURE_DIR:-$OUT_ROOT/$TS-$SCENARIO}"
mkdir -p "$CAPTURE_DIR"

export CAPTURE_DIR
export CAPTURE_SCENARIO="$SCENARIO"

# LAN IP (폰 Wi‑Fi 프록시용)
LAN_IP=""
for iface in en0 en1; do
  if ip="$(ipconfig getifaddr "$iface" 2>/dev/null)"; then
    LAN_IP="$ip"
    break
  fi
done

cat <<EOF
========================================
 DashboardStock 트래픽 캡처
========================================
 시나리오 : $SCENARIO
 모드     : $MODE  (web=UI / dump=터미널만)
 포트     : $PORT
 저장     : $CAPTURE_DIR
 Mac IP   : ${LAN_IP:-unknown}
 폰 프록시: ${LAN_IP:-<MacIP>}:$PORT
 CA 인증서: $CONFDIR/mitmproxy-ca-cert.cer
========================================
 폰 설정 후 앱/웹에서 시나리오 수행.
 종료: Ctrl+C  → summary.md 생성
========================================
EOF

# adb reverse 보조 (USB 연결 시 127.0.0.1:PORT → Mac)
if command -v adb >/dev/null 2>&1; then
  if adb devices 2>/dev/null | grep -qE 'device$'; then
    adb reverse "tcp:$PORT" "tcp:$PORT" || true
    echo " adb reverse tcp:$PORT 설정됨 (폰에서 127.0.0.1:$PORT 도 가능)"
  fi
fi

ADDON="$ROOT/addon_filter.py"
COMMON=(
  --listen-host 0.0.0.0
  --listen-port "$PORT"
  --set "confdir=$CONFDIR"
  --set ssl_insecure=true
  -s "$ADDON"
)

if [[ "$MODE" == "dump" ]]; then
  exec mitmdump "${COMMON[@]}"
else
  # mitmweb: 브라우저 UI http://127.0.0.1:8081
  exec mitmweb "${COMMON[@]}" --web-host 127.0.0.1 --web-port 8081
fi
