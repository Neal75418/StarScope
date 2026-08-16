"""
Tests for services/context_fetcher.py - Context signal fetching service.
Simplified to only test HN signals after product simplification.
"""

import asyncio
from datetime import datetime, timezone
from unittest.mock import patch, AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import SQLAlchemyError

from services.context_fetcher import (
    fetch_context_signals_for_repo,
    fetch_all_context_signals,
)
# Import module for accessing protected members in tests
from services import context_fetcher as context_fetcher_module


def create_mock_hn_story(object_id: str, title: str = "Test HN Story") -> MagicMock:
    """Create a mock HN story for testing."""
    story = MagicMock()
    story.object_id = object_id
    story.title = title
    story.url = f"https://example.com/{object_id}"
    story.points = 100
    story.num_comments = 50
    story.author = "testuser"
    story.created_at = datetime.now(timezone.utc)
    return story


class TestGetExistingSignalMap:
    """Tests for _get_existing_signal_map function."""

    def test_empty_external_ids(self, test_db, mock_repo):
        """Test with empty external_ids returns empty dict."""
        result = context_fetcher_module._get_existing_signal_map(
            mock_repo.id, "hacker_news", [], test_db
        )
        assert result == {}

    def test_no_existing_signals(self, test_db, mock_repo):
        """Test with no existing signals returns empty dict."""
        result = context_fetcher_module._get_existing_signal_map(
            mock_repo.id, "hacker_news", ["abc123"], test_db
        )
        assert result == {}


class TestStoreHnSignals:
    """Tests for _store_hn_signals function."""

    def test_stores_new_signals(self, test_db, mock_repo):
        """Test storing new HN signals."""
        from db.models import ContextSignal

        stories = [create_mock_hn_story("hn1"), create_mock_hn_story("hn2")]
        count = context_fetcher_module._store_hn_signals(mock_repo.id, stories, test_db)  # type: ignore[arg-type]

        assert count == 2
        # Verify records were added to the session (flush to materialize)
        test_db.flush()
        stored = test_db.query(ContextSignal).filter(
            ContextSignal.repo_id == mock_repo.id
        ).all()
        assert len(stored) == 2
        stored_ids = {s.external_id for s in stored}
        assert stored_ids == {"hn1", "hn2"}

    def test_empty_stories(self, test_db, mock_repo):
        """Test with empty stories list."""
        count = context_fetcher_module._store_hn_signals(mock_repo.id, [], test_db)
        assert count == 0


class TestFetchContextSignalsForRepo:
    """Tests for fetch_context_signals_for_repo function."""

    @pytest.mark.asyncio
    async def test_fetches_hn_signals(self, test_db, mock_repo):
        """Test fetching HN signals."""
        with patch(
            'services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock
        ) as mock_hn:
            mock_hn.return_value = [create_mock_hn_story("hn1")]

            hn_count = await fetch_context_signals_for_repo(mock_repo, test_db)

            assert hn_count == 1

    @pytest.mark.asyncio
    async def test_handles_db_errors(self, test_db, mock_repo):
        """Test handling SQLAlchemy errors from signal storage."""
        with patch(
            'services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock
        ) as mock_hn, patch(
            'services.context_fetcher._store_hn_signals',
            side_effect=SQLAlchemyError("DB write error"),
        ):
            mock_hn.return_value = [create_mock_hn_story("hn1")]

            hn_count = await fetch_context_signals_for_repo(mock_repo, test_db)

            # SQLAlchemyError should result in 0 count, not crash
            assert hn_count == 0


class TestFetchAllContextSignals:
    """Tests for fetch_all_context_signals function."""

    @pytest.mark.asyncio
    async def test_processes_all_repos(self, test_db, mock_multiple_repos):
        """Test processing all repos in watchlist."""
        with patch(
            'services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock
        ) as mock_hn:
            mock_hn.return_value = []

            result = await fetch_all_context_signals(test_db)

            assert result["repos_processed"] == 3
            assert result["errors"] == 0

    @pytest.mark.asyncio
    async def test_a_store_failure_is_counted_and_the_batch_continues(
        self, test_db, mock_multiple_repos
    ):
        """寫入失敗要計入 errors，而且不能中斷其他 repo。

        這條原本 patch 的是 fetch_context_signals_for_repo 並讓它拋 SQLAlchemyError，
        但那個函式自己就把 SQLAlchemyError 吞掉了——真實路徑產生不出被模擬的那個情境，
        斷言恆真。改成打真正會失敗的那一層。
        """
        with patch(
            'services.context_fetcher.fetch_hn_mentions', new_callable=AsyncMock
        ) as mock_hn, patch(
            'services.context_fetcher._store_hn_signals',
            side_effect=SQLAlchemyError("DB write error"),
        ):
            mock_hn.return_value = [create_mock_hn_story("hn1")]

            result = await fetch_all_context_signals(test_db)

        assert result["errors"] == 3
        assert result["repos_processed"] == 3
        assert result["new_hn_signals"] == 0

    @pytest.mark.asyncio
    async def test_one_repos_failure_does_not_stop_the_others(
        self, test_db, mock_multiple_repos
    ):
        """安全網要真的只攔住那一個 repo。

        原本三個 repo 全部失敗時也會 errors == 1（因為整批只有一個 mock），
        看不出隔離有沒有生效。這裡只讓中間那個炸掉。
        """
        attempted: list[str] = []

        async def _boom_on_vue(owner: str, name: str):
            attempted.append(name)
            if name == "vue":
                raise RuntimeError("Unexpected failure")
            return []

        with patch('services.context_fetcher.fetch_hn_mentions', new=_boom_on_vue):
            result = await fetch_all_context_signals(test_db)

        assert result["errors"] == 1
        assert sorted(attempted) == ["angular", "react", "vue"], "其他 repo 仍要照跑"


@pytest.fixture
def many_repos(test_db):
    """夠多的 repo，好讓併發上限真的會卡到。

    只有 3 個的話，「同時在飛最多 5 個」這個斷言不管有沒有 Semaphore 都會過。
    """
    from db.models import Repo

    repos = [
        Repo(
            owner="o", name=f"r{i}", full_name=f"o/r{i}",
            url=f"https://github.com/o/r{i}", github_id=1000 + i,
        )
        for i in range(12)
    ]
    test_db.add_all(repos)
    test_db.commit()
    return repos


class TestFetchAllConcurrency:
    """整批掃描的網路請求要併發，但要有上限。"""

    @pytest.mark.asyncio
    async def test_requests_run_concurrently_but_within_the_cap(self, test_db, many_repos):
        """直接數「同時在飛的最大數」，不量時間。

        牆鐘時間分不出「序列」與「併發但機器很忙」——先前用時間門檻寫的併發測試
        就是這樣在 CI 上偽陽性的。這裡數的是行為本身。
        """
        in_flight = 0
        peak = 0

        async def _tracked(owner: str, name: str):
            nonlocal in_flight, peak
            in_flight += 1
            peak = max(peak, in_flight)
            await asyncio.sleep(0)  # 讓出控制權，其他 coroutine 才進得來
            in_flight -= 1
            return []

        with patch('services.context_fetcher.fetch_hn_mentions', new=_tracked):
            result = await fetch_all_context_signals(test_db)

        assert result["repos_processed"] == 12
        assert peak > 1, "沒有併發：每個 repo 仍在等前一個跑完"
        assert peak <= context_fetcher_module.CONTEXT_FETCH_CONCURRENCY, (
            f"併發沒有上限（同時 {peak} 個）"
        )

    @pytest.mark.asyncio
    async def test_every_fetch_finishes_before_the_first_write(self, test_db, many_repos):
        """網路全部跑完，才開始寫。

        把寫入搬進 coroutine 看起來更快，但 Session 會被多個 coroutine 交錯使用——
        某個 coroutine 的 commit 會把別人才加到一半的東西一起送出去，而且是間歇性的，
        只在真實資料上發作。這裡測的是「gather 完才寫」這個結構，不是測時間。

        不要改成數「同時有幾個 writer」：_store_hn_signals 是同步的，單執行緒 event
        loop 裡它不可能跟自己重疊，那種斷言不管程式怎麼寫都會過。
        """
        fetches_done = 0
        fetches_done_at_first_write: int | None = None

        async def _fetch(owner: str, name: str):
            nonlocal fetches_done
            await asyncio.sleep(0)
            fetches_done += 1
            return [create_mock_hn_story(f"hn-{name}")]

        def _store(repo_id, stories, db):
            nonlocal fetches_done_at_first_write
            if fetches_done_at_first_write is None:
                fetches_done_at_first_write = fetches_done
            return 1

        with patch('services.context_fetcher.fetch_hn_mentions', new=_fetch), \
             patch.object(context_fetcher_module, '_store_hn_signals', new=_store):
            result = await fetch_all_context_signals(test_db)

        assert result["new_hn_signals"] == 12
        assert fetches_done_at_first_write == 12, (
            f"第一筆寫入時只抓完 {fetches_done_at_first_write} 個——寫入跑進 coroutine 裡了"
        )
