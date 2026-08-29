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


def _today_snapshot(db, repo_id) -> RepoSnapshot:
    """upsert 之後不再回傳 ORM 物件（原子寫入沒有東西可回），驗證一律查 DB——
    這本來就更誠實：驗的是實際存了什麼，不是函式想像自己存了什麼。"""
    snap: RepoSnapshot = (
        db.query(RepoSnapshot)
        .filter(RepoSnapshot.repo_id == repo_id,
                RepoSnapshot.snapshot_date == utc_today())
        .one()
    )
    return snap


class TestCreateOrUpdateSnapshot:
    """Tests for create_or_update_snapshot."""

    def test_creates_new_snapshot(self, test_db, mock_repo):
        """首次呼叫應建立新快照。"""
        create_or_update_snapshot(mock_repo, SAMPLE_GITHUB_DATA, test_db)

        snapshot = _today_snapshot(test_db, mock_repo.id)
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
        create_or_update_snapshot(mock_repo, updated_data, test_db)

        assert _today_snapshot(test_db, mock_repo.id).stars == 6000

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
        create_or_update_snapshot(mock_repo, {}, test_db)

        snapshot = _today_snapshot(test_db, mock_repo.id)
        assert snapshot.stars == 0
        assert snapshot.forks == 0
        assert snapshot.watchers == 0
        assert snapshot.open_issues == 0

    def test_uses_subscribers_count_for_watchers(self, test_db, mock_repo):
        """watchers 應使用 subscribers_count（真正的 watcher 欄位）。"""
        data = {"subscribers_count": 999, "watchers_count": 111}
        create_or_update_snapshot(mock_repo, data, test_db)

        # 應使用 subscribers_count 而非 watchers_count
        assert _today_snapshot(test_db, mock_repo.id).watchers == 999


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


class TestUpsertSurvivesCrossProcessRace:
    def test_double_insert_same_day_does_not_raise(self, test_db, mock_repo):
        """模擬跨行程 race 的落地形狀：兩個「都以為今天還沒有快照」的寫入接連
        到達。舊的 check-then-act 會讓第二個撞 uq_snapshot_repo_date 炸
        IntegrityError、把該 repo 整輪更新 rollback 沖銷；upsert 之後第二個
        寫入安靜地變成更新。"""
        create_or_update_snapshot(mock_repo, {"stargazers_count": 100}, test_db)
        # 不 commit、不查詢——直接再寫一次，等同對方行程先落地的效果
        create_or_update_snapshot(mock_repo, {"stargazers_count": 105}, test_db)
        test_db.commit()

        snap = _today_snapshot(test_db, mock_repo.id)
        assert snap.stars == 105
        n = test_db.query(RepoSnapshot).filter(
            RepoSnapshot.repo_id == mock_repo.id).count()
        assert n == 1


def test_first_fetch_of_day_is_visible_to_same_transaction_signals(test_db, mock_repo):
    """upsert 立即落 DB（autoflush=False 下 ORM add() 做不到）：當天首次抓取後，
    同一 transaction 內的 calculate_signals 查得到今日快照，stars_delta_1d
    不再被吞成 None。改回 ORM 寫法會讓每天第一輪的 delta 靜默消失。"""
    from services.analyzer import calculate_signals

    yesterday = utc_today() - timedelta(days=1)
    test_db.add(RepoSnapshot(repo_id=mock_repo.id, stars=4950, forks=300,
                             watchers=120, open_issues=42, snapshot_date=yesterday))
    test_db.commit()

    # 當天首次寫入（5000 星），刻意不 flush/commit——模擬 update_repo_from_github
    # 內 create_or_update_snapshot 之後立即算訊號的真實順序
    create_or_update_snapshot(mock_repo, SAMPLE_GITHUB_DATA, test_db)
    signals = calculate_signals(mock_repo.id, test_db)

    assert signals.get("stars_delta_1d") == 50
