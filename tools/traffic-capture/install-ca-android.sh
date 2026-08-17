#!/usr/bin/env bash
# mitmproxy CA 를 USB 연결된 Android 로 복사 + 설치 안내
set -euo pipefail

CONFDIR="${MITMPROXY_CONFDIR:-$HOME/.mitmproxy}"
CER="$CONFDIR/mitmproxy-ca-cert.cer"
PEM="$CONFDIR/mitmproxy-ca-cert.pem"
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
[[ -x "$ADB" ]] || ADB="$(command -v adb)"

if [[ ! -f "$CER" && ! -f "$PEM" ]]; then
  echo "CA 없음. 먼저 mitmproxy 를 한 번 실행해 인증서를 생성하세요."
  echo "  mitmdump -q &  sleep 1; kill %1"
  exit 1
fi

SRC="$CER"
[[ -f "$SRC" ]] || SRC="$PEM"

echo "device:"
"$ADB" devices -l
echo
"$ADB" push "$SRC" /sdcard/Download/mitmproxy-ca-cert.cer
echo
cat <<'EOF'
[폰에서 할 일]

1) 설정 → 보안 및 개인정보 보호 → 기타 보안 설정
   → 인증서 설치 / 저장소에서 설치 → CA 인증서
   → Download/mitmproxy-ca-cert.cer 선택
   → 이름: mitmproxy

2) 설정 → Wi‑Fi → 현재 네트워크 수정
   → 프록시 수동
   → 호스트: Mac LAN IP (start-capture.sh 출력값)
   → 포트: 8080

   또는 USB only:
   → 호스트: 127.0.0.1  포트: 8080
   (start-capture.sh 가 adb reverse 를 걸어 둠)

3) 폰 Chrome 으로 http://mitm.it 접속
   → “Android” 인증서 안내가 보이면 프록시 정상

4) 검증: Chrome 에서 https://api.thinkpool.com/signal/periodProfit
   → mitmweb(http://127.0.0.1:8081) 에 요청이 보이면 성공

[주의 — Android 7+ 앱 SSL]
· 사용자 CA 는 브라우저에는 통하지만, 대부분의 앱(영웅문 포함)은
  시스템 CA 만 신뢰하거나 인증서 피닝을 씁니다.
· 영웅문 트래픽이 CONNECT 만 보이고 복호화 실패(TLS error)면
  → RUNBOOK.md 의 “피닝 우회” 절을 보세요.
· 우선순위: (1) Chrome 으로 씽크풀 웹 캡처
            (2) 영웅문 앱 (피닝 시 추가 작업)

캡처 종료 후 프록시 설정을 “없음”으로 되돌리세요.
EOF
