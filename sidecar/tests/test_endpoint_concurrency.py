"""
endpoint 不能在 event loop 上等資料庫連線。

Session 是同步的：`async def` endpoint 裡的查詢直接跑在 event loop 上，連線池用完時
`checkout` 會把整個 loop 卡住。佔著連線的是已經查完、等著 get_db 收尾歸還連線的請求，
而收尾要靠 loop 排進 threadpool——loop 卡住就永遠還不回來，直到 pool timeout（30 秒）。
症狀是前端整排停在 Loading、連 CORS preflight 都沒有回應。
寫成 `def` 的 endpoint 由 FastAPI 放進 threadpool，等連線的是 worker thread，loop 照常運作。

conftest 的 test_engine 是 StaticPool（一條共用連線、不排隊），其他測試看不到這個問題。
"""

import ast
import asyncio
import time
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.database import get_db
from db.models import Base

ROUTERS_DIR = Path(__file__).resolve().parent.parent / "routers"
_HTTP_METHODS = {"get", "post", "put", "delete", "patch"}
POOL_TIMEOUT_SECONDS = 3

# 不 await 卻寫成 async 的 endpoint，只允許完全不碰 I/O 的（DB、檔案、keyring 都算 I/O）。
# health_check 刻意留在 loop 上：threadpool 被佔滿時健康檢查仍要能回應
PURE_ASYNC_ENDPOINTS = {"health_check", "list_signal_types", "clear_cache"}


def _endpoints():
    for path in sorted(ROUTERS_DIR.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and any(
                isinstance(d, ast.Call) and getattr(d.func, "attr", None) in _HTTP_METHODS
                for d in node.decorator_list
            ):
                yield path.name, node


def test_async_endpoints_without_await_are_pure():
    # 沒有 await 的 async def 等於把整段同步程式放在 loop 上跑；會碰 DB 的（包括經由 service 裡的
    # SessionLocal）寫成 def 就好。
    # 這條管不到有 await 的 endpoint：它們 await 前後的 DB 操作仍在 loop 上，連線池滿時一樣會卡住
    offenders = [
        f"{file}:{node.lineno} {node.name}"
        for file, node in _endpoints()
        if isinstance(node, ast.AsyncFunctionDef)
        and node.name not in PURE_ASYNC_ENDPOINTS
        and not any(isinstance(n, (ast.Await, ast.AsyncFor, ast.AsyncWith)) for n in ast.walk(node))
    ]
    assert not offenders, f"這些 endpoint 應改成 def（或確認不碰 I/O 後加進 PURE_ASYNC_ENDPOINTS）：{offenders}"


def test_pure_async_allowlist_has_no_stale_names():
    async_names = {node.name for _, node in _endpoints() if isinstance(node, ast.AsyncFunctionDef)}
    assert PURE_ASYNC_ENDPOINTS <= async_names


def test_the_scan_finds_the_endpoints():
    # 對照組：掃描本身壞掉（例如 router 改用別的 decorator 寫法）時
    # test_async_endpoints_without_await_are_pure 會空跑變綠
    names = {node.name for _, node in _endpoints()}
    assert {"list_early_signals", "get_signal_summary", "list_repos"} <= names


@pytest.fixture
def one_connection_engine(client, tmp_path):
    """連線池只有一條連線、不 overflow；get_db 改用它。"""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'pool.db'}",
        connect_args={"check_same_thread": False},
        pool_size=1,
        max_overflow=0,
        pool_timeout=POOL_TIMEOUT_SECONDS,
    )
    Base.metadata.create_all(bind=engine)
    session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    client.app.dependency_overrides[get_db] = override_get_db
    yield engine
    engine.dispose()


async def test_waiting_for_a_connection_does_not_freeze_the_server(client, one_connection_engine):
    held = one_connection_engine.connect()  # 拿走唯一的連線，讓請求只能排隊
    transport = httpx.ASGITransport(app=client.app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8008") as ac:
            request = asyncio.create_task(ac.get("/api/early-signals/"))

            started = time.monotonic()
            await asyncio.sleep(0.2)
            slept = time.monotonic() - started
            # 前提：請求真的在等連線。沒走到被覆寫的 get_db 的話，上面的 sleep 量不到任何東西
            assert not request.done(), "請求沒有在等連線，測試前提不成立"

            held.close()
            held = None
            resp = await request
    finally:
        if held is not None:
            held.close()

    # loop 被卡住的話，這個 sleep 要等到 pool timeout 才醒得過來
    assert slept < 1, f"event loop 被卡了 {slept:.1f} 秒"
    assert resp.status_code == 200
