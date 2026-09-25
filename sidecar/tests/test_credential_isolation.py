"""測試碰不到開發者的 GitHub 憑證，也連不到外網。

conftest 的 client 會跑 lifespan 的 star 同步，而 token 解析順序是 Keychain → 資料庫 → 環境變數。
在開發機上不隔離的話，測試會讀到 Keychain 裡的真 token 並用它打 GitHub；忘了 mock 的寫入路徑
（斷開連線、儲存 token）更會直接改動開發者的帳號設定。靠每條測試自己記得 mock 守不住，
所以在 conftest 一律隔離。

斷言一律先算成布林值：這些測試正是在「真的洩漏了」的時候才會紅，那時 pytest 的
assertion rewrite 會把比較的物件整個印出來——整份 os.environ 或 token 的值。
"""

import os

import httpx
import pytest

from constants import GITHUB_TOKEN_ENV_VAR


def test_tests_never_see_the_real_keychain():
    import keyring
    from keyring.backends.null import Keyring as NullKeyring

    is_null = isinstance(keyring.get_keyring(), NullKeyring)
    assert is_null, "測試用的是真的 keyring backend"


def test_a_dotenv_file_cannot_bring_the_token_back(tmp_path):
    """main.py 在 import 時呼叫 load_dotenv()，從 main.py 所在目錄往上找第一個 .env
    （coverage／debugger 底下改從 cwd 找），可能找到 repo 根目錄放著真 token 的那份。
    load_dotenv 預設不覆蓋已存在的 key，所以 conftest 必須把 GITHUB_TOKEN 設成空字串佔住，
    而不是刪掉。"""
    from dotenv import load_dotenv

    dotenv_file = tmp_path / ".env"
    dotenv_file.write_text(f"{GITHUB_TOKEN_ENV_VAR}=fake_token_from_dotenv\n")

    load_dotenv(dotenv_file)
    leaked = bool(os.environ.get(GITHUB_TOKEN_ENV_VAR))
    os.environ[GITHUB_TOKEN_ENV_VAR] = ""  # 萬一洩漏了，別讓後面的測試帶著它跑

    assert not leaked, ".env 裡的 GITHUB_TOKEN 回到了環境變數"


def test_sync_requests_cannot_reach_the_network():
    # 127.0.0.1:9 沒有東西在聽：閘門失效時這裡是連線錯誤，不會真的連到外網
    with pytest.raises(RuntimeError, match="測試不能連外網"):
        httpx.get("http://127.0.0.1:9/")


async def test_async_requests_cannot_reach_the_network():
    async with httpx.AsyncClient() as client:
        with pytest.raises(RuntimeError, match="測試不能連外網"):
            await client.get("http://127.0.0.1:9/")
