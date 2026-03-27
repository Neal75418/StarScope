"""Sidecar 啟停生命週期測試。"""

import asyncio
from unittest.mock import AsyncMock, patch, MagicMock

import pytest


@pytest.fixture
def mock_lifecycle():
    """模擬 lifespan 內的所有依賴。"""
    with (
        patch("main.init_db") as init_db,
        patch("main.start_scheduler") as start_sched,
        patch("main.stop_scheduler", new_callable=AsyncMock) as stop_sched,
        patch("main.close_github_service", new_callable=AsyncMock) as close_gh,
        patch("main.trigger_fetch_now", new_callable=AsyncMock) as trigger,
    ):
        trigger.return_value = None
        yield {
            "init_db": init_db,
            "start_scheduler": start_sched,
            "stop_scheduler": stop_sched,
            "close_github": close_gh,
            "trigger_fetch": trigger,
        }


class TestShutdownOrder:
    """shutdown 順序：stop_scheduler → await task → close_github。"""

    @pytest.mark.asyncio
    async def test_scheduler_stops_before_client_closes(self, mock_lifecycle):
        """排程器應在 HTTP client 之前停止。"""
        call_order: list[str] = []
        async def track_stop():
            call_order.append("stop_scheduler")
        mock_lifecycle["stop_scheduler"].side_effect = track_stop

        async def track_close():
            call_order.append("close_github")

        mock_lifecycle["close_github"].side_effect = track_close

        from main import lifespan, app

        async with lifespan(app):
            pass

        assert "stop_scheduler" in call_order
        assert "close_github" in call_order
        assert call_order.index("stop_scheduler") < call_order.index("close_github")

    @pytest.mark.asyncio
    async def test_startup_task_cancel_is_awaited(self, mock_lifecycle):
        """取消的 startup task 應被 await（無 unhandled exception）。"""
        cancel_observed = False
        started = asyncio.Event()

        async def slow_fetch():
            nonlocal cancel_observed
            started.set()
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                cancel_observed = True
                raise

        mock_lifecycle["trigger_fetch"].side_effect = slow_fetch

        from main import lifespan, app

        async with lifespan(app):
            await started.wait()  # 確保 startup task 已開始執行

        assert cancel_observed, "startup task 應被 cancel 並 await"


class TestStartupResilience:
    """startup fetch 失敗不應阻止應用啟動。"""

    @pytest.mark.asyncio
    async def test_startup_fetch_error_does_not_crash(self, mock_lifecycle):
        """startup fetch 拋出例外時應用仍能啟動，shutdown 也不拋出。"""
        mock_lifecycle["trigger_fetch"].side_effect = Exception("GitHub API down")

        from main import lifespan, app

        async with lifespan(app):
            await asyncio.sleep(0.01)  # 讓 task 執行並失敗

        # 如果到這裡沒拋出，表示 shutdown 正確消化了 task 的例外
