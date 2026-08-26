"""
無頭收集器的編排：順序、離線預檢、容錯、備份兜底。

各 job 本身已有自己的測試，這裡守的是 run_jobs 把它們串起來的方式——
與 test_main_lifecycle 守 App 啟動序列是同一件事的兩個入口。
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import run_jobs


def _mocks(order: list) -> dict:
    def rec(name, async_=True):
        m = AsyncMock() if async_ else MagicMock()
        def _side(*a, **k):
            order.append(name)
        m.side_effect = _side
        return m
    return {
        "sync": rec("sync"),
        "fetch": rec("fetch"),
        "alerts": rec("alerts", async_=False),
        "context": rec("context"),
        "releases": rec("releases"),
        "close_gh": AsyncMock(),
        "close_hn": AsyncMock(),
    }


def _run(m, online=True, sync_result=None):
    if sync_result is None:  # "recorded" 之類的哨兵值表示呼叫端已自行設定 sync mock
        sync_result = MagicMock(skipped_reason=None)
        m["sync"].side_effect = None
        m["sync"].return_value = sync_result
    with patch.object(run_jobs, "_online", return_value=online), \
         patch("db.database.init_db"), \
         patch("db.database.SessionLocal", return_value=MagicMock()), \
         patch("services.star_sync.sync_starred_repos", m["sync"]), \
         patch("services.github.get_github_service", return_value=MagicMock()), \
         patch("services.github.close_github_service", m["close_gh"]), \
         patch("services.hacker_news.close_hn_service", m["close_hn"]), \
         patch("services.scheduler.fetch_all_repos_job", m["fetch"]), \
         patch("services.scheduler.check_alerts_job", m["alerts"]), \
         patch("services.scheduler.fetch_context_signals_job", m["context"]), \
         patch("services.scheduler.fetch_releases_job", m["releases"]), \
         patch.object(run_jobs, "_backup_if_stale"):
        import asyncio
        return asyncio.run(run_jobs.run_once())


class TestRunOnce:
    def test_offline_skips_everything_without_touching_services(self):
        """離線時不該對 94 個 repo 各失敗一次——預檢退出，下一小時重試。"""
        order: list = []
        m = _mocks(order)
        assert _run(m, online=False) == "offline-skip"
        assert order == []
        m["close_gh"].assert_not_called()  # 沒建立過就沒東西可關

    def test_jobs_run_in_the_startup_order(self):
        """star 同步先於抓取：抓取跑的是當下的追蹤清單，反過來會漏掉剛同步進來的。"""
        order: list = []
        m = _mocks(order)

        def _sync_and_record(*a, **k):
            order.append("sync")
            return MagicMock(skipped_reason=None)

        # sync 必須進 order——只驗後四個的話，把 sync 移到 fetch 之後照樣綠，
        # 而「sync 先於 fetch」正是這條測試存在的理由
        m["sync"].side_effect = _sync_and_record
        assert _run(m, sync_result="recorded") == "ok"
        assert order == ["sync", "fetch", "alerts", "context", "releases"]
        m["sync"].assert_awaited_once()
        m["close_gh"].assert_awaited_once()
        m["close_hn"].assert_awaited_once()

    def test_star_sync_failure_does_not_block_the_fetch(self):
        """與 main.py 啟動序列相同的容錯：沒有新 star 時既有清單仍該更新。"""
        order: list = []
        m = _mocks(order)
        m["sync"].side_effect = RuntimeError("github down for stars only")
        assert _run(m) == "ok"
        assert "fetch" in order

    def test_services_are_closed_even_when_a_job_raises(self):
        order: list = []
        m = _mocks(order)
        m["sync"].side_effect = None
        m["sync"].return_value = MagicMock(skipped_reason=None)
        m["fetch"].side_effect = RuntimeError("boom")
        with pytest.raises(RuntimeError):
            _run(m)
        m["close_gh"].assert_awaited_once()
        m["close_hn"].assert_awaited_once()


class TestBackupCatchUp:
    def _call(self, latest):
        with patch("services.backup.find_latest_backup", return_value=latest), \
             patch("services.backup.backup_database") as bk:
            run_jobs._backup_if_stale()
            return bk

    def test_runs_when_no_backup_exists(self):
        assert self._call(None).called

    def test_runs_when_stale_beyond_threshold(self):
        old = datetime.now(timezone.utc) - timedelta(hours=25)
        assert self._call(old).called

    def test_skips_when_fresh(self):
        """cron 02:00 剛跑過的日子不要疊一份——兜底只補缺，不加量。"""
        fresh = datetime.now(timezone.utc) - timedelta(hours=2)
        assert not self._call(fresh).called
