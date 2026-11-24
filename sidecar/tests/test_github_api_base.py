"""GitHub API 網址的覆蓋（STARSCOPE_GITHUB_API_BASE）：e2e 用它改連本機的假 GitHub。

預設網址是 token 會送去的地方，所以覆蓋只收 http://127.0.0.1、打包版一律忽略、沒有獨立資料目錄時起不來、
覆蓋時不帶 token、也不走 proxy。
"""

import logging
import os
import subprocess
import sys
from pathlib import Path

import httpx
import pytest

import services.github as github_module
from constants import GITHUB_API_BASE_ENV_VAR
from services.github import (
    DEFAULT_GITHUB_API_BASE,
    GitHubService,
    get_github_service,
    reset_github_service,
    resolve_github_api_base,
)

SIDECAR_DIR = Path(__file__).resolve().parents[1]


def _resolve(value: str | None, *, frozen: bool = False, isolated_data_dir: bool = True) -> str | None:
    return resolve_github_api_base(value, frozen=frozen, isolated_data_dir=isolated_data_dir)


class TestResolveGitHubApiBase:
    @pytest.mark.parametrize("value", [None, ""])
    def test_no_override_when_unset(self, value):
        assert _resolve(value) is None

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("http://127.0.0.1:8010", "http://127.0.0.1:8010"),
            ("http://127.0.0.1:8010/", "http://127.0.0.1:8010"),
            ("http://127.0.0.1", "http://127.0.0.1"),
        ],
    )
    def test_accepts_loopback_http_in_canonical_form(self, value, expected):
        assert _resolve(value) == expected

    @pytest.mark.parametrize(
        "value",
        [
            "https://127.0.0.1:8010",  # 只收 http：本機的假伺服器沒有憑證
            "ftp://127.0.0.1:8010",
            # localhost 交給系統解析，可能先連 ::1：假 GitHub 只綁 127.0.0.1，那個 port 上要是有別的服務就連錯
            "http://localhost:8010",
            "http://LOCALHOST:8010",
            "http://evil.example.com",
            "http://127.0.0.1.evil.example.com",
            "http://user:pw@127.0.0.1:8010",  # 帶帳密：不同解析器對 @ 的理解可能不同
            "http://127.0.0.1\\@evil.example.com",
            "http://127.0.0.1:8010/api",
            "http://127.0.0.1:8010?x=1",
            "http://127.0.0.1:8010#frag",
            "http://127.0.0.1:99999",  # port 不合法
            "http://[::1]:8010",
            "http://[127.0.0.1]:8010",  # urlsplit 自己就會丟錯：訊息也要帶變數名
            "http://[",
            "127.0.0.1:8010",  # 沒有 scheme
        ],
    )
    def test_rejects_anything_else_naming_the_variable(self, value):
        with pytest.raises(ValueError, match=GITHUB_API_BASE_ENV_VAR):
            _resolve(value)

    @pytest.mark.parametrize("isolated_data_dir", [True, False])
    @pytest.mark.parametrize("value", ["http://127.0.0.1:8010", "http://evil.example.com"])
    def test_ignored_in_the_packaged_app(self, value, isolated_data_dir):
        # 打包版的環境變數可能被別的程式設進來（Tauri 不清環境）：一律忽略、連檢查都不做，
        # 不靠任何環境變數判斷，也不讓一個奇怪的值把 app 弄到起不來
        # 打包版的真實情況是沒有獨立資料目錄：那裡也要忽略，不能落到「沒有獨立資料目錄就起不來」
        assert _resolve(value, frozen=True, isolated_data_dir=isolated_data_dir) is None

    @pytest.mark.parametrize("value", ["http://127.0.0.1:8010", "http://evil.example.com"])
    def test_refused_without_an_isolated_data_dir(self, value):
        # 沒有獨立資料目錄＝用的是真實資料（開發模式的 sidecar、launchd 的 collector）：那裡連假 GitHub 會讓本機資料
        # 和 GitHub 對不上。e2e 的設定漏了 STARSCOPE_DATA_DIR 時也走到這裡：寧可起不來，不要默默改連真的 GitHub
        with pytest.raises(ValueError, match="STARSCOPE_DATA_DIR"):
            _resolve(value, isolated_data_dir=False)


class TestServiceWithOverriddenBase:
    # 任何不是預設的網址都要丟 token，不只本機的：這是 token 外洩的最後一道
    @pytest.fixture(params=["http://127.0.0.1:9", "http://localhost:9", "http://example.invalid"])
    def overridden(self, request, monkeypatch):
        monkeypatch.setattr(github_module, "GITHUB_API_BASE", request.param)
        return request.param

    def test_token_is_dropped(self, overridden):
        service = GitHubService(token="ghp_secret")

        assert "Authorization" not in service.headers
        assert service.can_write is False

    def test_proxy_settings_are_not_used(self, overridden):
        # 開發者 shell 裡的 HTTP_PROXY 會讓 httpx 連 127.0.0.1 也走 proxy：e2e 會連不到假 GitHub
        assert GitHubService().client.trust_env is False

    def test_token_is_kept_for_the_real_github(self):
        assert github_module.GITHUB_API_BASE == DEFAULT_GITHUB_API_BASE
        service = GitHubService(token="ghp_secret")

        assert service.headers["Authorization"] == "Bearer ghp_secret"
        assert service.can_write is True
        assert service.client.trust_env is True

    async def test_requests_go_to_the_overridden_base(self, overridden):
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, json={"full_name": "octocat/Hello-World"})

        service = GitHubService(token="ghp_secret")
        service._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            await service.get_repo("octocat", "Hello-World")
        finally:
            await service.aclose()

        assert [str(r.url) for r in seen] == [f"{overridden}/repos/octocat/Hello-World"]
        assert "authorization" not in seen[0].headers


class TestStartupWarnings:
    @pytest.fixture(autouse=True)
    def fresh_service(self):
        reset_github_service()
        yield
        reset_github_service()

    def test_says_so_when_the_base_is_overridden(self, monkeypatch, caplog):
        monkeypatch.setattr(github_module, "GITHUB_API_BASE", "http://127.0.0.1:9")
        with caplog.at_level(logging.WARNING, logger="services.github"):
            get_github_service()

        assert "http://127.0.0.1:9" in caplog.text

    def test_says_so_when_the_variable_is_ignored(self, monkeypatch, caplog):
        # 打包版忽略：留一行 log，免得以為連的是假 GitHub
        monkeypatch.setattr(github_module, "_API_BASE_ENV_VALUE", "http://127.0.0.1:9")
        with caplog.at_level(logging.WARNING, logger="services.github"):
            get_github_service()

        assert GITHUB_API_BASE_ENV_VAR in caplog.text

    def test_silent_when_unset(self, caplog):
        with caplog.at_level(logging.WARNING, logger="services.github"):
            get_github_service()

        assert GITHUB_API_BASE_ENV_VAR not in caplog.text
        assert "改連" not in caplog.text


_KEEP = object()


def _import_base(
    env_value: str | None, *, frozen: bool = False, data_dir: object = _KEEP, home: Path | None = None
) -> subprocess.CompletedProcess[str]:
    """另開一個 Python import services.github，看模組載入時實際接上的網址（不在測試行程裡 reload 模組）。

    data_dir：_KEEP＝沿用測試的暫存資料目錄；None＝不設 STARSCOPE_DATA_DIR；字串＝設成那個值。
    不用測試的資料目錄時 db.database 一 import 就建資料目錄：HOME 一定要指到暫存目錄，碰不到真實的 ~/.starscope。
    """
    env = {k: v for k, v in os.environ.items() if k != GITHUB_API_BASE_ENV_VAR}
    if env_value is not None:
        env[GITHUB_API_BASE_ENV_VAR] = env_value
    if data_dir is not _KEEP:
        assert home is not None
        env["HOME"] = str(home)
        env.pop("STARSCOPE_DATA_DIR", None)
        if data_dir is not None:
            env["STARSCOPE_DATA_DIR"] = str(data_dir)
    prelude = "import sys; sys.frozen = True; " if frozen else ""
    code = prelude + "import services.github as g; print(g.GITHUB_API_BASE)"
    return subprocess.run(
        [sys.executable, "-c", code], cwd=SIDECAR_DIR, env=env, capture_output=True, text=True, timeout=60
    )


class TestModuleWiring:
    def test_unset_uses_the_real_github(self):
        result = _import_base(None)
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == DEFAULT_GITHUB_API_BASE

    def test_env_var_sets_the_base(self):
        result = _import_base("http://127.0.0.1:8010/")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "http://127.0.0.1:8010"

    def test_invalid_value_stops_the_sidecar_from_starting(self):
        result = _import_base("http://evil.example.com")
        assert result.returncode != 0
        assert GITHUB_API_BASE_ENV_VAR in result.stderr

    def test_packaged_app_ignores_the_env_var(self, tmp_path):
        # 照打包版的真實情況：沒有 STARSCOPE_DATA_DIR（HOME 指到暫存目錄）
        result = _import_base("http://127.0.0.1:8010", frozen=True, data_dir=None, home=tmp_path)
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == DEFAULT_GITHUB_API_BASE

    @pytest.mark.parametrize(
        "data_dir",
        [None, "", "{home}/.starscope", "{home}/x/../.starscope", "{home}/link-to-real"],
        ids=["unset", "empty", "explicitly-the-real-one", "dot-dot", "symlink"],
    )
    def test_real_data_refuses_the_env_var(self, tmp_path, data_dir):
        # 判斷看 db.database 實際用的資料目錄是不是同一個（samefile）：空字串、明確指到預設位置、繞路或 symlink 都還是真實資料
        (tmp_path / ".starscope").mkdir()
        (tmp_path / "x").mkdir()
        (tmp_path / "link-to-real").symlink_to(tmp_path / ".starscope")
        value = None if data_dir is None else data_dir.format(home=tmp_path)
        result = _import_base("http://127.0.0.1:8010", data_dir=value, home=tmp_path)

        assert result.returncode != 0
        assert GITHUB_API_BASE_ENV_VAR in result.stderr
        assert (tmp_path / ".starscope").is_dir()  # 前提：真的用了（暫存 HOME 底下的）預設資料目錄

    def test_real_data_spelled_with_other_case_refuses_the_env_var(self, tmp_path):
        # macOS（APFS）不分大小寫：~/.STARSCOPE 就是真實資料。只比路徑字串（resolve）認不出來
        (tmp_path / ".starscope").mkdir()
        if not (tmp_path / ".STARSCOPE").exists():
            pytest.skip("檔案系統分大小寫：~/.STARSCOPE 是另一個目錄")
        result = _import_base("http://127.0.0.1:8010", data_dir=tmp_path / ".STARSCOPE", home=tmp_path)

        assert result.returncode != 0
        assert GITHUB_API_BASE_ENV_VAR in result.stderr

    def test_isolated_data_dir_allows_the_override(self, tmp_path):
        result = _import_base("http://127.0.0.1:8010", data_dir=tmp_path / "e2e", home=tmp_path)

        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "http://127.0.0.1:8010"
