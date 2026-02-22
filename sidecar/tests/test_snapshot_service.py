"""Tests for services/snapshot.py — create_or_update_snapshot & update_repo_from_github."""

from datetime import timedelta
from unittest.mock import patch

import pytest

from db.models import Repo, RepoSnapshot
from services.snapshot import create_or_update_snapshot, update_repo_from_github
from utils.time import utc_now, utc_today


# ── Fixtures ──────────────────────────────────────────────


SAMPLE_GITHUB_DATA = {
    "stargazers_count": 5000,
    "forks_count": 300,
    "subscribers_count": 120,
    "open_issues_count": 42,
    "description": "Updated description",
    "language": "TypeScript",
}


# ── create_or_update_snapshot ─────────────────────────────


class TestCreateOrUpdateSnapshot:
    """Tests for create_or_update_snapshot."""

    def test_creates_new_snapshot(self, test_db, mock_repo):
        """首次呼叫應建立新快照。"""
        snapshot = create_or_update_snapshot(mock_repo, SAMPLE_GITHUB_DATA, test_db)
        test_db.flush()

        assert snapshot.repo_id == mock_repo.id
        assert snapshot.stars == 5000
        assert snapshot.forks == 300
        assert snapshot.watchers == 120  # subscribers_count
        assert snapshot.open_issues == 42
        assert snapshot.snapshot_date == utc_today()

    def test_updates_existing_snapshot_same_day(self, test_db, mock_repo):
        """同一天重複呼叫應更新現有快照，不建立新的。"""
        # 第一次建立
        create_or_update_snapshot(mock_repo, SAMPLE_GITHUB_DATA, test_db)
        test_db.flush()

        # 第二次更新
        updated_data = {**SAMPLE_GITHUB_DATA, "stargazers_count": 6000}
        snapshot = create_or_update_snapshot(mock_repo, updated_data, test_db)
        test_db.flush()

        assert snapshot.stars == 6000

        # 確認只有一筆快照
        count = (
            test_db.query(RepoSnapshot)
            .filter(
                RepoSnapshot.repo_id == mock_repo.id,
                RepoSnapshot.snapshot_date == utc_today(),
            )
            .count()
        )
        assert count == 1

    def test_handles_missing_fields(self, test_db, mock_repo):
        """缺少欄位時應預設為 0。"""
        snapshot = create_or_update_snapshot(mock_repo, {}, test_db)
        test_db.flush()

        assert snapshot.stars == 0
        assert snapshot.forks == 0
        assert snapshot.watchers == 0
        assert snapshot.open_issues == 0

    def test_uses_subscribers_count_for_watchers(self, test_db, mock_repo):
        """watchers 應使用 subscribers_count（真正的 watcher 欄位）。"""
        data = {"subscribers_count": 999, "watchers_count": 111}
        snapshot = create_or_update_snapshot(mock_repo, data, test_db)
        test_db.flush()

        # 應使用 subscribers_count 而非 watchers_count
        assert snapshot.watchers == 999


# ── update_repo_from_github ───────────────────────────────


class TestUpdateRepoFromGithub:
    """Tests for update_repo_from_github."""

    @patch("services.snapshot.calculate_signals")
    def test_updates_metadata(self, mock_calc, test_db, mock_repo):
        """應更新 repo 的 description 和 language。"""
        update_repo_from_github(mock_repo, SAMPLE_GITHUB_DATA, test_db)

        assert mock_repo.description == "Updated description"
        assert mock_repo.language == "TypeScript"

    @patch("services.snapshot.calculate_signals")
    def test_creates_snapshot(self, mock_calc, test_db, mock_repo):
        """應建立快照。"""
        update_repo_from_github(mock_repo, SAMPLE_GITHUB_DATA, test_db)

        snapshots = (
            test_db.query(RepoSnapshot)
            .filter(RepoSnapshot.repo_id == mock_repo.id)
            .all()
        )
        assert len(snapshots) == 1
        assert snapshots[0].stars == 5000

    @patch("services.snapshot.calculate_signals")
    def test_calls_calculate_signals(self, mock_calc, test_db, mock_repo):
        """應呼叫 calculate_signals 重新計算訊號。"""
        update_repo_from_github(mock_repo, SAMPLE_GITHUB_DATA, test_db)

        mock_calc.assert_called_once_with(mock_repo.id, test_db)

    @patch("services.snapshot.calculate_signals")
    def test_commits_atomically(self, mock_calc, test_db, mock_repo):
        """應在最後提交所有變更。"""
        update_repo_from_github(mock_repo, SAMPLE_GITHUB_DATA, test_db)

        # 驗證資料已持久化（不需手動 commit）
        refreshed = test_db.query(Repo).filter(Repo.id == mock_repo.id).first()
        assert refreshed.description == "Updated description"
