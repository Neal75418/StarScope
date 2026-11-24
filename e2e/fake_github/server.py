"""e2e 用的假 GitHub REST API。

e2e 的 sidecar 用 STARSCOPE_GITHUB_API_BASE 改連這裡，不打真的 GitHub：CI 用的匿名配額是 runner 共用 IP 的，
常在我們用之前就被別人用光；本機也不會碰到使用者的 token。

- GET /repos/{owner}/{repo}：repos/ 裡有錄下來的真實回應就照回，沒有就回 GitHub 一樣的 404。
  owner／repo 不分大小寫（GitHub 也是）；用啟動時建的對照表查，不靠檔案系統（macOS 不分、Linux 分）
- 其他端點與任何別的方法：回 501，並在 stderr 印一行 `fake-github: unexpected request …`，不會默默去連真的
  GitHub。呼叫端把錯誤往外拋時 spec 會紅；被吞掉的（例如抓 release）由 CI 的
  「Check fake GitHub got only expected requests」看 log 判紅。要支援就在這裡加，資料錄真實回應
- 只綁 127.0.0.1，只用標準函式庫（用 sidecar 的 venv 跑）

用法：python e2e/fake_github/server.py --port 8010
"""

import argparse
import json
import re
import sys
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPOS_DIR = Path(__file__).resolve().parent / "repos"
HEALTH_PATH = "/__fake_github/health"
# owner 不含 .，repo 名稱可以有（octocat.github.io）；檔名把 / 換成 __，不會跳出 REPOS_DIR
REPO_PATH = re.compile(r"^/repos/([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)$")
# 小寫的 "owner__repo" → 錄下來的檔案
RECORDED = {path.stem.lower(): path for path in REPOS_DIR.glob("*.json")}


class FakeGitHubHandler(BaseHTTPRequestHandler):
    server_version = "fake-github"

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == HEALTH_PATH:
            self._send_json(200, {"ok": True})
            return
        match = REPO_PATH.match(path)
        if match is None:
            self._unexpected()
            return
        recorded = RECORDED.get(f"{match.group(1)}__{match.group(2)}".lower())
        if recorded is not None:
            self._send(200, recorded.read_bytes())
        else:
            self._send_json(404, {"message": "Not Found", "status": "404"})

    def do_POST(self) -> None:
        self._unexpected()

    def do_PUT(self) -> None:
        self._unexpected()

    def do_PATCH(self) -> None:
        self._unexpected()

    def do_DELETE(self) -> None:
        self._unexpected()

    def __getattr__(self, name: str) -> Callable[[], None]:
        # BaseHTTPRequestHandler 用 hasattr 找 do_<方法>：HEAD、OPTIONS 等沒寫的方法也走 unexpected，
        # 不然它回的預設 501 不會留下記號
        if name.startswith("do_"):
            return self._unexpected
        raise AttributeError(name)

    def _unexpected(self) -> None:
        # 印到 stderr：Playwright 的 webServer 預設只轉 stderr，本機跑 e2e 時才看得到
        print(f"fake-github: unexpected request {self.command} {self.path}", file=sys.stderr, flush=True)
        self._send_json(501, {"message": "fake-github: unexpected request"})

    def _send_json(self, status: int, body: dict) -> None:
        self._send(status, json.dumps(body).encode("utf-8"))

    def _send(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 — 覆寫標準函式庫的參數名
        # 每個請求一行，印到 stdout：CI 失敗時從 log 看得出 e2e 打了什麼
        print(f"fake-github: {format % args}", flush=True)


def make_server(port: int) -> ThreadingHTTPServer:
    """只綁 127.0.0.1：測試用的假資料不需要、也不該讓別的機器連得到。"""
    return ThreadingHTTPServer(("127.0.0.1", port), FakeGitHubHandler)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="e2e 用的假 GitHub REST API")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args(argv)
    server = make_server(args.port)
    print(f"fake-github: listening on http://127.0.0.1:{server.server_address[1]}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
