"""e2e 用的假 GitHub（e2e/fake_github/server.py）：真的起一個程序，照 e2e 的方式打它。

e2e 的 sidecar 只連它（STARSCOPE_GITHUB_API_BASE），所以它要：認得的儲存庫回錄下來的真實回應、
其他儲存庫回 GitHub 一樣的 404、沒預料到的端點回 501 並在 stderr 記一行（CI 看到這行就判紅）。
用標準函式庫的 urllib 打：conftest 的 block_real_network 擋的是 httpx 的真 transport（連本機也擋）。
sidecar 經由它解析回應這段由 e2e 實際跑一輪驗證；改連的網址由 test_github_api_base 守。
CI 與本機的接線（port 一致、sidecar 帶著改連的網址、CI 檢查 unexpected）也在這裡守。
"""

import importlib.util
import json
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
FAKE_DIR = REPO_ROOT / "e2e" / "fake_github"
HEALTH_PATH = "/__fake_github/health"


def _request(method: str, url: str) -> tuple[int, str, bytes]:
    """回 (狀態碼, Content-Type, 內容)；4xx／5xx 也照樣回，不丟例外。"""
    req = urllib.request.Request(url, method=method)
    try:
        # 不走 proxy：開發者 shell 裡的 HTTP_PROXY 會讓 urllib 連 127.0.0.1 也走 proxy
        with _NO_PROXY.open(req, timeout=5) as resp:
            return resp.status, resp.headers.get("Content-Type", ""), resp.read()
    except urllib.error.HTTPError as err:
        # HTTPError 本身也是要關的回應
        with err:
            return err.code, err.headers.get("Content-Type", ""), err.read()


_NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture
def fake_github() -> Iterator[tuple[str, subprocess.Popen[str]]]:
    port = _free_port()
    proc = subprocess.Popen(
        [sys.executable, str(FAKE_DIR / "server.py"), "--port", str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                if _request("GET", base + HEALTH_PATH)[0] == 200:
                    break
            except OSError:
                pass
            if time.monotonic() > deadline or proc.poll() is not None:
                pytest.fail("fake GitHub did not start")
            time.sleep(0.05)
        yield base, proc
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        for pipe in (proc.stdout, proc.stderr):
            if pipe is not None:
                pipe.close()


def _stderr(proc: subprocess.Popen[str]) -> str:
    proc.terminate()
    _, err = proc.communicate(timeout=10)
    return err


def _e2e_fixture_repos() -> list[str]:
    """e2e/helpers.ts 的 FIXTURES 裡列的儲存庫：e2e 會新增它們，假 GitHub 必須每個都有資料。"""
    helpers = (REPO_ROOT / "e2e" / "helpers.ts").read_text(encoding="utf-8")
    block = re.search(r"export const FIXTURES = \{(.*?)\} as const;", helpers, re.S)
    assert block is not None
    # 只認雙引號字串：改成單引號或 template 字串的話，下面的 findall 會漏抓、檢查跟著空過
    rest = re.sub(r'"[^"\n]*"', "", block.group(1))
    assert "'" not in rest
    assert "`" not in rest
    repos = re.findall(r'"([A-Za-z0-9-]+/[A-Za-z0-9._-]+)"', block.group(1))
    assert repos  # 解析不到東西時，下面的檢查會空過
    return repos


def test_every_e2e_fixture_repo_has_recorded_data():
    for full_name in _e2e_fixture_repos():
        path = FAKE_DIR / "repos" / f"{full_name.replace('/', '__')}.json"
        assert path.is_file(), f"假 GitHub 沒有 {full_name} 的資料"
        assert json.loads(path.read_text(encoding="utf-8"))["full_name"] == full_name


def test_known_repo_returns_the_recorded_response(fake_github):
    base, _ = fake_github

    status, content_type, body = _request("GET", base + "/repos/octocat/Hello-World")

    assert status == 200
    assert content_type.startswith("application/json")
    assert json.loads(body)["full_name"] == "octocat/Hello-World"


def test_repo_names_are_matched_case_insensitively_like_github(fake_github):
    # 檔案系統的大小寫在 macOS 與 Linux CI 不一樣：查詢不能靠它
    base, _ = fake_github

    status, _, body = _request("GET", base + "/repos/OCTOCAT/hello-world")

    assert status == 200
    assert json.loads(body)["full_name"] == "octocat/Hello-World"


def test_unknown_repo_is_not_found_like_github(fake_github):
    base, _ = fake_github

    status, _, body = _request("GET", base + "/repos/octocat/no-such-repo")

    assert status == 404
    assert json.loads(body)["message"] == "Not Found"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/search/repositories?q=rust"),
        ("GET", "/repos/octocat/Hello-World/releases/latest"),
        ("PUT", "/user/starred/octocat/Hello-World"),
        # 寫入方法打已知儲存庫的路徑也一樣：不能被當成 GET 照回錄下來的資料
        ("POST", "/repos/octocat/Hello-World"),
        ("PUT", "/repos/octocat/Hello-World"),
        ("PATCH", "/repos/octocat/Hello-World"),
        ("DELETE", "/repos/octocat/Hello-World"),
        # 沒有寫 do_X 的方法也一樣要記成 unexpected（BaseHTTPRequestHandler 預設的 501 不會）
        ("HEAD", "/repos/octocat/Hello-World"),
        ("OPTIONS", "/repos/octocat/Hello-World"),
    ],
)
def test_unexpected_request_fails_loudly_and_is_logged(fake_github, method, path):
    base, proc = fake_github

    status, _, _ = _request(method, base + path)

    assert status == 501
    # 印到 stderr：Playwright 的 webServer 預設只轉 stderr，本機才看得到
    assert f"fake-github: unexpected request {method} {path}" in _stderr(proc)


def test_listens_on_loopback_only():
    spec = importlib.util.spec_from_file_location("fake_github_server", FAKE_DIR / "server.py")
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    server = module.make_server(0)
    try:
        assert server.server_address[0] == "127.0.0.1"
    finally:
        server.server_close()


# --- 接線：e2e 真的連到它（11-24 的 429 是因為 e2e 打真的 GitHub） ---

def _workflow_steps() -> dict[str, dict]:
    document = yaml.safe_load((REPO_ROOT / ".github" / "workflows" / "test.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["test-e2e"]["steps"]
    return {step["name"]: step for step in steps if "name" in step}


def test_ci_starts_it_and_points_the_sidecar_at_it():
    steps = _workflow_steps()
    port_match = re.search(r"e2e/fake_github/server\.py --port (\d+)", steps["Start fake GitHub"]["run"])
    assert port_match is not None
    port = port_match.group(1)

    assert f"127.0.0.1:{port}{HEALTH_PATH}" in steps["Wait for fake GitHub"]["run"]
    sidecar_env = steps["Start sidecar"]["env"]
    assert sidecar_env["STARSCOPE_GITHUB_API_BASE"] == f"http://127.0.0.1:{port}"
    # 沒有獨立資料目錄時覆蓋會讓 sidecar 起不來（services/github.py）：漏了這行就是整個 job 紅
    assert sidecar_env["STARSCOPE_DATA_DIR"]
    document = yaml.safe_load((REPO_ROOT / ".github" / "workflows" / "test.yml").read_text(encoding="utf-8"))
    for env in (sidecar_env, document.get("env") or {}, document["jobs"]["test-e2e"].get("env") or {}):
        assert "GITHUB_TOKEN" not in env
    names = list(steps)
    assert names.index("Start fake GitHub") < names.index("Start sidecar")


CHECK_STEP = "Check fake GitHub got only expected requests"


def test_ci_checks_the_fake_after_e2e_even_when_e2e_failed():
    steps = _workflow_steps()
    check = steps[CHECK_STEP]

    assert check["if"] == "${{ !cancelled() }}"
    assert "continue-on-error" not in check  # 這步失敗要讓 job 變紅
    names = list(steps)
    assert names.index("Run E2E tests") < names.index(CHECK_STEP)


def _run_check(tmp_path: Path, log_text: str | None, base: str) -> subprocess.CompletedProcess[str]:
    """照 GitHub Actions 的方式（bash -eo pipefail）跑那一步的 script，log 路徑與假 GitHub 的網址換成測試的。"""
    steps = _workflow_steps()
    log_match = re.search(r"> (\S+) 2>&1 &", steps["Start fake GitHub"]["run"])
    port_match = re.search(r"--port (\d+)", steps["Start fake GitHub"]["run"])
    assert log_match is not None
    assert port_match is not None
    log = tmp_path / "fake-github.log"
    if log_text is not None:
        log.write_text(log_text, encoding="utf-8")
    script = steps[CHECK_STEP]["run"]
    assert log_match.group(1) in script
    assert f"http://127.0.0.1:{port_match.group(1)}" in script
    script = script.replace(log_match.group(1), str(log)).replace(f"http://127.0.0.1:{port_match.group(1)}", base)
    return subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script],
        capture_output=True,
        text=True,
        timeout=60,
    )


UNEXPECTED_LINE = "fake-github: unexpected request GET /repos/octocat/Hello-World/releases/latest\n"
EXPECTED_LINE = 'fake-github: "GET /repos/octocat/Hello-World HTTP/1.1" 200 -\n'


def test_ci_check_fails_when_e2e_hit_an_endpoint_it_does_not_have(fake_github, tmp_path):
    # 呼叫端把 501 吞掉時（例如抓 release）spec 不會紅：要靠這一步判紅
    base, _ = fake_github
    result = _run_check(tmp_path, EXPECTED_LINE + UNEXPECTED_LINE, base)
    assert result.returncode == 1
    assert "::error::" in result.stdout


def test_ci_check_passes_when_only_expected_requests_were_made(fake_github, tmp_path):
    base, _ = fake_github
    result = _run_check(tmp_path, EXPECTED_LINE, base)
    assert result.returncode == 0, result.stdout + result.stderr


def test_ci_check_skips_when_the_fake_never_started(tmp_path):
    # 更前面的步驟就失敗（例如 npm ci）時沒有 log：job 已經是紅的，不要再多報一條指錯方向的「沒有回應」
    result = _run_check(tmp_path, None, f"http://127.0.0.1:{_free_port()}")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "::error::" not in result.stdout


def test_ci_check_fails_when_the_fake_died_during_e2e(tmp_path):
    # 假 GitHub 中途掛掉時，被吞掉的路徑只拿到連線錯誤、log 裡也沒有記號
    result = _run_check(tmp_path, EXPECTED_LINE, f"http://127.0.0.1:{_free_port()}")
    assert result.returncode == 1
    assert "::error::" in result.stdout


def test_local_playwright_starts_it_and_points_the_sidecar_at_it():
    config = (REPO_ROOT / "playwright.config.ts").read_text(encoding="utf-8")
    port_match = re.search(r"const E2E_FAKE_GITHUB_PORT = (\d+);", config)
    assert port_match is not None
    ci_port = re.search(
        r"--port (\d+)", _workflow_steps()["Start fake GitHub"]["run"]
    )
    assert ci_port is not None
    assert port_match.group(1) == ci_port.group(1)

    assert "e2e/fake_github/server.py --port ${E2E_FAKE_GITHUB_PORT}" in config
    assert "STARSCOPE_GITHUB_API_BASE=http://127.0.0.1:${E2E_FAKE_GITHUB_PORT}" in config
    # 沒有獨立資料目錄時覆蓋會讓 sidecar 起不來（services/github.py）
    assert re.search(r"STARSCOPE_DATA_DIR=\S+", config)
    # 一律不帶 token：不能再靠 E2E_NO_TOKEN 之類的旗標
    assert "GITHUB_TOKEN= " in config
    assert "PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring" in config
    assert "E2E_NO_TOKEN" not in config
