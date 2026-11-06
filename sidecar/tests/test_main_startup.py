"""main.py 啟動序列裡「不擋啟動、但也不能無聲」的步驟。"""
import logging
import os
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
import uvicorn
from fastapi import FastAPI

from constants import APP_VERSION
from db.models import AppSettingKey
from services.settings import get_setting


def test_record_app_version_writes_current_version(test_db, test_session_local):
    from main import _record_app_version

    with patch("db.database.SessionLocal", test_session_local):
        _record_app_version()

    assert get_setting(AppSettingKey.LAST_OPENED_APP_VERSION, test_db) == APP_VERSION


def test_record_app_version_failure_is_logged_at_warning(test_session_local, caplog):
    """失敗不擋啟動，但執行期 level 是 INFO——記在 DEBUG 等於沒記。這個值是使用者回報
    問題時唯一的升級路徑線索，寫不進去時留下的是錯的舊版號，比沒線索更糟。"""
    from main import _record_app_version

    with patch("db.database.SessionLocal", test_session_local), \
         patch("services.settings.get_setting", side_effect=RuntimeError("database is locked")), \
         caplog.at_level(logging.WARNING, logger="main"):
        _record_app_version()  # 不該拋

    assert any(
        r.levelno == logging.WARNING and "記錄 app 版本失敗" in r.getMessage()
        for r in caplog.records
    ), "失敗要在 WARNING 以上留下痕跡"


def test_github_token_check_runs_after_init_db(test_session_local):
    """token 檢查會讀 app_settings；全新安裝時那張表要等 init_db() 才存在。

    檢查若排在 init_db() 之前，每次首次啟動都會記一條「no such table」的 WARNING——
    重審抓到的：把 log 等級從 debug 升上來時沒注意到它的位置。
    """
    from fastapi.testclient import TestClient
    from main import app

    order: list[object] = []
    with patch("services.scheduler.start_scheduler"), \
         patch("services.scheduler.stop_scheduler", new_callable=AsyncMock), \
         patch("services.scheduler.trigger_fetch_now", return_value=None), \
         patch("main.init_db", side_effect=lambda: order.append("init_db")), \
         patch("db.database.SessionLocal", test_session_local), \
         patch("services.settings.SessionLocal", test_session_local), \
         patch("services.settings.get_setting",
               side_effect=lambda key, *a, **k: order.append(("get_setting", key))):
        with TestClient(app):
            pass

    token_read = ("get_setting", AppSettingKey.GITHUB_TOKEN)
    assert "init_db" in order, order
    assert token_read in order, order
    assert order.index("init_db") < order.index(token_read), order



def test_debug_mode_keeps_hot_reload():
    """reload 需要 import 字串：reloader 在子行程裡重新 import 這個模組。"""
    import main

    with patch.object(main, "DEBUG", True), patch("main.uvicorn.run") as run:
        main.run_server()

    assert run.call_args.args[0] == "main:app"
    assert run.call_args.kwargs["reload"] is True


def test_release_mode_passes_the_app_object_not_an_import_string():
    """PyInstaller 打包後入口模組叫 __main__，沒有可以 import 的 "main"——
    傳 "main:app" 會讓發行版一啟動就 `Could not import module "main"` 退出。"""
    import main

    with patch.object(main, "DEBUG", False), patch("main.uvicorn.Server") as server_cls, \
            patch("main.uvicorn.run") as run:
        main.run_server()

    config = server_cls.call_args.args[0]
    assert config.app is main.app
    assert not config.reload
    server_cls.return_value.run.assert_called_once()
    run.assert_not_called()


def test_frozen_binary_ignores_debug(monkeypatch):
    """打包後的 binary 就算從使用者的環境變數讀到 DEBUG=true 也不能開 reload：
    reloader 會先佔住 port，子行程再跑一次入口又綁同一個 port，結果行程活著卻永遠不服務。"""
    import main

    # sys.frozen 只有 PyInstaller 打包後才存在，型別存根裡沒有
    # noinspection PyUnresolvedReferences
    monkeypatch.setattr("sys.frozen", True, raising=False)
    with patch.object(main, "DEBUG", True), patch("main.uvicorn.Server") as server_cls, \
            patch("main.uvicorn.run") as run:
        main.run_server()

    assert server_cls.call_args.args[0].app is main.app
    run.assert_not_called()


def test_release_mode_starts_the_parent_watchdog_when_told_the_parent_pid(monkeypatch):
    import main

    monkeypatch.setenv("STARSCOPE_PARENT_PID", "4242")
    with patch.object(main, "DEBUG", False), patch("main.uvicorn.Server") as server_cls, \
            patch("main.uvicorn.run"), patch("main.start_parent_watchdog") as watchdog:
        main.run_server()

    pid, on_parent_gone = watchdog.call_args.args
    assert pid == 4242
    server = server_cls.return_value
    server.should_exit = False
    on_parent_gone()
    assert server.should_exit is True  # 走 uvicorn 的正常關閉，不是直接殺掉


def test_release_mode_without_a_parent_pid_has_no_watchdog(monkeypatch):
    import main

    monkeypatch.delenv("STARSCOPE_PARENT_PID", raising=False)
    with patch.object(main, "DEBUG", False), patch("main.uvicorn.Server"), \
            patch("main.uvicorn.run"), patch("main.start_parent_watchdog") as watchdog:
        main.run_server()

    watchdog.assert_not_called()


def test_frozen_binary_does_not_read_dotenv_from_the_working_directory(tmp_path):
    """打包後的 python-dotenv 改從 cwd 往上找 .env：從終端機啟動安裝版時，cwd 上層任何一個 .env
    都能帶進 HTTPS_PROXY、SSL_CERT_FILE、GITHUB_TOKEN 這類變數。

    在子行程裡真的 import main：讀 .env 發生在 import 的那一刻，直接呼叫 helper 守不住
    「模組層改回直接呼叫 load_dotenv()」。
    """
    probe = "STARSCOPE_TEST_DOTENV_PROBE"
    (tmp_path / ".env").write_text(f"{probe}=from-cwd\n", encoding="utf-8")
    sidecar_dir = str(Path(__file__).resolve().parents[1])
    code = (
        f"import os, sys; sys.path.insert(0, {sidecar_dir!r}); sys.frozen = True; "
        f"import main; print('PROBE=' + os.environ.get({probe!r}, ''))"
    )
    env = {**os.environ, "STARSCOPE_DATA_DIR": str(tmp_path / "data"),
           "PYTHON_KEYRING_BACKEND": "keyring.backends.null.Keyring", "GITHUB_TOKEN": ""}
    env.pop(probe, None)

    proc = subprocess.run([sys.executable, "-c", code], cwd=tmp_path, env=env,
                          capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr

    # main import 時的 logging 也寫 stdout，只看探針那一行
    assert [line for line in proc.stdout.splitlines() if line.startswith("PROBE=")] == ["PROBE="]


def test_source_runs_still_read_dotenv(monkeypatch):
    """從原始碼執行（開發模式）仍要讀 sidecar/.env：開發者的 GITHUB_TOKEN、PORT 等設定從這裡來。

    mock 掉 load_dotenv：真的讀的話會從 main.py 所在目錄往上找，讀到開發者放著真 token 的 .env。
    """
    import main

    monkeypatch.delattr("sys.frozen", raising=False)
    with patch("main.load_dotenv") as load:
        main._load_dotenv_unless_frozen()

    load.assert_called_once_with()


@pytest.fixture
def uvicorn_loggers_as_in_a_fresh_process():
    """正式環境的行程裡，建 Config 之前 uvicorn 的 logger 沒有自己的 handler、會往 root 傳；
    setup_logging 只調了 uvicorn.access 的等級。其他測試用預設 log_config 建過 Config 的話
    會留下 propagate=False，這裡先還原成那個狀態，結束後放回原樣。"""
    names = ("uvicorn", "uvicorn.error", "uvicorn.access")
    saved = {name: (lg.handlers[:], lg.propagate, lg.level)
             for name in names for lg in [logging.getLogger(name)]}
    for name in names:
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
        lg.setLevel(logging.NOTSET)
    yield
    for name, (handlers, propagate, level) in saved.items():
        lg = logging.getLogger(name)
        lg.handlers = handlers
        lg.propagate = propagate
        lg.setLevel(level)


@pytest.mark.asyncio
async def test_release_mode_startup_failure_reaches_the_app_log(
    monkeypatch, caplog, uvicorn_loggers_as_in_a_fresh_process,
):
    """lifespan 失敗時 uvicorn 以 uvicorn.error 記下 traceback 再 exit(3)。那筆紀錄要傳到 root 的
    handler（starscope.log）：安裝版的 stderr 沒有人收，使用者只會看到「結束代碼 3」。"""
    import main

    def fail_like_a_schema_check() -> None:
        raise RuntimeError("schema needs migration (test)")

    @asynccontextmanager
    async def failing_lifespan(_app):
        fail_like_a_schema_check()
        yield

    monkeypatch.delenv("STARSCOPE_PARENT_PID", raising=False)
    with patch.object(main, "DEBUG", False), \
            patch.object(main, "app", FastAPI(lifespan=failing_lifespan)), \
            patch("main.uvicorn.Server") as server_cls:
        main.run_server()
    config = server_cls.call_args.args[0]

    with caplog.at_level(logging.ERROR), pytest.raises(SystemExit):
        await uvicorn.Server(config).serve()

    assert any(
        r.name == "uvicorn.error" and "schema needs migration (test)" in r.getMessage()
        for r in caplog.records
    ), "啟動失敗的 traceback 沒有傳到 root 的 handler"
