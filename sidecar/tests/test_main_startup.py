"""main.py 啟動序列裡「不擋啟動、但也不能無聲」的步驟。"""
import logging
from unittest.mock import AsyncMock, patch

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
    assert "init_db" in order and token_read in order, order
    assert order.index("init_db") < order.index(token_read), order



def test_release_mode_passes_the_app_object_not_an_import_string():
    """PyInstaller 打包後入口模組叫 __main__，沒有可以 import 的 "main"——
    傳 "main:app" 會讓發行版一啟動就 `Could not import module "main"` 退出。"""
    import main

    with patch.object(main, "DEBUG", False), patch("main.uvicorn.run") as run:
        main.run_server()

    target = run.call_args.args[0]
    assert target is main.app
    assert not run.call_args.kwargs.get("reload")


def test_debug_mode_keeps_hot_reload():
    """reload 需要 import 字串：reloader 在子行程裡重新 import 這個模組。"""
    import main

    with patch.object(main, "DEBUG", True), patch("main.uvicorn.run") as run:
        main.run_server()

    assert run.call_args.args[0] == "main:app"
    assert run.call_args.kwargs["reload"] is True


def test_frozen_binary_ignores_debug(monkeypatch):
    """打包後的 binary 就算讀到 DEBUG=true（使用者環境變數、上層目錄的 .env）也不能開 reload：
    reloader 會先佔住 port，子行程再跑一次入口又綁同一個 port，結果行程活著卻永遠不服務。"""
    import sys
    import main

    monkeypatch.setattr(sys, "frozen", True, raising=False)
    with patch.object(main, "DEBUG", True), patch("main.uvicorn.run") as run:
        main.run_server()

    assert run.call_args.args[0] is main.app
    assert not run.call_args.kwargs.get("reload")
