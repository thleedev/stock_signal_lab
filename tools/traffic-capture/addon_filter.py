"""
mitmproxy 애드온: 키움·씽크풀·라씨 관련 트래픽만 구조화 저장.

사용:
  mitmweb -s tools/traffic-capture/addon_filter.py --set confdir=~/.mitmproxy
  CAPTURE_SCENARIO=lassi-open mitmdump -s tools/traffic-capture/addon_filter.py

환경변수:
  CAPTURE_DIR      저장 루트 (기본: tools/traffic-capture/out/<timestamp>)
  CAPTURE_SCENARIO 시나리오 태그 (기본: manual)
  CAPTURE_SAVE_BODY 응답 본문 저장 (기본: 1)
  CAPTURE_MAX_BODY  본문 최대 바이트 (기본: 2_000_000)
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from mitmproxy import ctx, http

# 관심 호스트 (부분 일치)
HOST_HINTS = (
    "kiwoom.com",
    "thinkpool.com",
    "rassiapp",
    "rassiro.com",
    "tradingpoint",
    "lefuture",
    "daou",
    "heromts",
    "smartopen",
)

# 관심 경로/키워드 (호스트가 빗나가도 잡기)
PATH_HINTS = (
    "signal",
    "rassi",
    "lassi",
    "alpha",
    "alphacatch",
    "알파",
    "holding",
    "portfolio",
    "recommend",
    "robo",
    "mts",
    "TR_",
    "signalToday",
    "paidMember",
    "heromts",
    "lefuture",
)

# 콘솔/인덱스에서 마스킹할 헤더
SENSITIVE_HEADERS = {
    "authorization",
    "cookie",
    "set-cookie",
    "secrete_token",
    "x-api-key",
    "x-auth-token",
    "x-access-token",
}


def _now_tag() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _default_capture_dir() -> Path:
    root = Path(__file__).resolve().parent / "out" / _now_tag()
    return root


class SignalTrafficCapture:
    def __init__(self) -> None:
        self.scenario = os.environ.get("CAPTURE_SCENARIO", "manual")
        self.save_body = os.environ.get("CAPTURE_SAVE_BODY", "1") != "0"
        self.max_body = int(os.environ.get("CAPTURE_MAX_BODY", "2000000"))
        env_dir = os.environ.get("CAPTURE_DIR")
        self.dir = Path(env_dir) if env_dir else _default_capture_dir()
        self.flows_dir = self.dir / "flows"
        self.index_path = self.dir / "index.jsonl"
        self.summary_path = self.dir / "summary.md"
        self.seq = 0
        self.matched = 0
        self.started_at = time.time()

    def load(self, loader) -> None:  # noqa: ANN001
        self.dir.mkdir(parents=True, exist_ok=True)
        self.flows_dir.mkdir(parents=True, exist_ok=True)
        meta = {
            "scenario": self.scenario,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "dir": str(self.dir),
        }
        (self.dir / "session.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        # 시나리오 체크리스트 복사 안 함 — 문서를 참조
        ctx.log.info(f"[capture] dir={self.dir}")
        ctx.log.info(f"[capture] scenario={self.scenario}")
        ctx.log.info("[capture] interesting hosts: " + ", ".join(HOST_HINTS[:6]) + "…")

    def done(self) -> None:
        self._write_summary()
        ctx.log.info(
            f"[capture] done matched={self.matched} elapsed={time.time()-self.started_at:.0f}s dir={self.dir}"
        )

    def response(self, flow: http.HTTPFlow) -> None:
        if not self._is_interesting(flow):
            return
        self.matched += 1
        self.seq += 1
        record = self._to_record(flow)
        flow_id = f"{self.seq:04d}_{record['method']}_{self._safe_name(record['host'] + record['path'])}"
        flow_path = self.flows_dir / f"{flow_id}.json"
        flow_path.write_text(
            json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        index_row = {
            "seq": self.seq,
            "ts": record["ts"],
            "scenario": self.scenario,
            "method": record["method"],
            "status": record["status"],
            "host": record["host"],
            "path": record["path"],
            "content_type": record.get("response_content_type"),
            "req_bytes": record.get("request_body_bytes"),
            "res_bytes": record.get("response_body_bytes"),
            "has_auth": record.get("has_auth"),
            "file": flow_path.name,
        }
        with self.index_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(index_row, ensure_ascii=False) + "\n")

        auth_mark = " AUTH" if record.get("has_auth") else ""
        ctx.log.info(
            f"[hit]{auth_mark} {record['method']} {record['status']} "
            f"{record['host']}{record['path'][:80]} → {flow_path.name}"
        )

    def _is_interesting(self, flow: http.HTTPFlow) -> bool:
        try:
            host = (flow.request.pretty_host or "").lower()
            path = (flow.request.path or "").lower()
            url = (flow.request.pretty_url or "").lower()
        except Exception:
            return False

        if any(h in host for h in HOST_HINTS):
            return True
        if any(p.lower() in path or p.lower() in url for p in PATH_HINTS):
            return True
        # JSON 응답 + 종목코드 패턴이면 후보로 남김 (노이즈 가능)
        try:
            if flow.response and flow.response.content:
                ct = flow.response.headers.get("content-type", "")
                if "json" in ct.lower() and re.search(
                    rb'"stockCode"\s*:\s*"\d{6}"', flow.response.content[:50000]
                ):
                    return True
        except Exception:
            pass
        return False

    def _to_record(self, flow: http.HTTPFlow) -> dict[str, Any]:
        req = flow.request
        res = flow.response
        host = req.pretty_host or ""
        path = urlparse(req.pretty_url).path or req.path or ""
        query = urlparse(req.pretty_url).query

        req_headers = {k: v for k, v in req.headers.items(multi=True)}
        res_headers = {k: v for k, v in res.headers.items(multi=True)} if res else {}

        has_auth = any(
            k.lower() in SENSITIVE_HEADERS or "token" in k.lower()
            for k in list(req_headers.keys()) + list(res_headers.keys())
        )

        record: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "scenario": self.scenario,
            "method": req.method,
            "url": req.pretty_url,
            "host": host,
            "path": path,
            "query": query,
            "status": res.status_code if res else None,
            "has_auth": has_auth,
            "request_headers": self._mask_headers(req_headers),
            "response_headers": self._mask_headers(res_headers),
            "request_headers_full_keys": sorted(req_headers.keys()),
            "response_content_type": res_headers.get("content-type")
            or res_headers.get("Content-Type"),
        }

        # 본문: 민 원문은 로컬 파일에만 두고, 헤더 마스킹 버전과 분리
        # 인증 원본은 *_secrets.json 에 저장 (gitignore)
        secrets: dict[str, Any] = {
            "request_headers": req_headers,
            "response_headers": res_headers,
        }

        if self.save_body:
            req_body = req.get_content() or b""
            res_body = (res.get_content() if res else b"") or b""
            record["request_body_bytes"] = len(req_body)
            record["response_body_bytes"] = len(res_body)
            record["request_body"] = self._decode_body(req_body)
            record["response_body"] = self._decode_body(res_body)
            secrets["request_body_raw_len"] = len(req_body)
            secrets["response_body_raw_len"] = len(res_body)

        # secrets 파일 (토큰 포함 원본 헤더)
        if has_auth:
            secrets_path = self.flows_dir / f"{self.seq:04d}_secrets.json"
            secrets_path.write_text(
                json.dumps(secrets, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            record["secrets_file"] = secrets_path.name

        return record

    def _mask_headers(self, headers: dict[str, str]) -> dict[str, str]:
        out = {}
        for k, v in headers.items():
            if k.lower() in SENSITIVE_HEADERS or "token" in k.lower():
                out[k] = f"<redacted len={len(v)}>"
            else:
                out[k] = v
        return out

    def _decode_body(self, raw: bytes) -> Any:
        if not raw:
            return None
        clipped = raw[: self.max_body]
        text: str
        try:
            text = clipped.decode("utf-8")
        except UnicodeDecodeError:
            return {"_binary": True, "preview_hex": clipped[:200].hex(), "len": len(raw)}
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            if len(text) > 20000:
                return text[:20000] + f"\n/* truncated, total={len(raw)} */"
            return text

    def _safe_name(self, s: str) -> str:
        s = re.sub(r"[^a-zA-Z0-9._-]+", "_", s)
        return s[:80].strip("_") or "flow"

    def _write_summary(self) -> None:
        if not self.index_path.exists():
            self.summary_path.write_text("# 캡처 없음\n", encoding="utf-8")
            return
        rows = [
            json.loads(line)
            for line in self.index_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        hosts: dict[str, int] = {}
        paths: dict[str, int] = {}
        auth_paths = []
        for r in rows:
            hosts[r["host"]] = hosts.get(r["host"], 0) + 1
            key = f"{r['method']} {r['host']}{r['path']}"
            paths[key] = paths.get(key, 0) + 1
            if r.get("has_auth"):
                auth_paths.append(key)

        lines = [
            f"# 트래픽 캡처 요약 — {self.scenario}",
            "",
            f"- 저장: `{self.dir}`",
            f"- 매칭 플로우: **{len(rows)}**",
            "",
            "## 호스트별",
            "",
        ]
        for h, c in sorted(hosts.items(), key=lambda x: -x[1]):
            lines.append(f"- `{h}`: {c}")
        lines += ["", "## 엔드포인트 (유니크)", ""]
        for p, c in sorted(paths.items(), key=lambda x: -x[1])[:80]:
            lines.append(f"- ({c}) `{p}`")
        if auth_paths:
            lines += ["", "## 인증 헤더 포함", ""]
            for p in sorted(set(auth_paths)):
                lines.append(f"- `{p}`")
        lines += [
            "",
            "## 다음 단계",
            "",
            "1. `flows/*.json` 에서 목록 JSON 응답 찾기",
            "2. `*_secrets.json` 에서 토큰/쿠키 이름만 기록 (커밋 금지)",
            "3. `findings-template.md` 에 엔드포인트 채우기",
            "",
        ]
        self.summary_path.write_text("\n".join(lines), encoding="utf-8")


addons = [SignalTrafficCapture()]
