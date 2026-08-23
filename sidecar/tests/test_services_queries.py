"""
services/queries.py 的共用讀取函式。

這裡守的是「取哪一筆」這種壞掉會安靜的事：get_snapshot_for_repo 取到最舊
的一筆，星數會變成有史以來的第一個值，而畫面上那仍然是一個合理的數字。
掃描時把 desc() 改成 asc()，760 個測試全綠。
"""
from datetime import timedelta

from db.models import RepoSnapshot
from services.queries import get_snapshot_for_repo
from utils.time import utc_now, utc_today


def _seed(db, repo_id: int, pairs):
    now = utc_now()
    today = utc_today()
    for days_ago, stars in pairs:
        db.add(RepoSnapshot(
            repo_id=repo_id, stars=stars, forks=0, watchers=0, open_issues=0,
            snapshot_date=today - timedelta(days=days_ago),
            fetched_at=now - timedelta(days=days_ago),
        ))
    db.commit()


class TestGetSnapshotForRepo:
    def test_returns_the_newest_snapshot_not_the_oldest(self, test_db, mock_repo):
        # 刻意讓最舊的那筆星數最高，這樣「取錯」不會剛好也答對
        _seed(test_db, mock_repo.id, [(10, 9000), (5, 1500), (0, 2000)])

        snap = get_snapshot_for_repo(mock_repo.id, test_db)

        assert snap is not None
        assert snap.stars == 2000, "應取今天那筆，不是最舊的 9000"
        assert snap.snapshot_date == utc_today()

    def test_returns_none_when_the_repo_has_no_snapshots(self, test_db, mock_repo):
        assert get_snapshot_for_repo(mock_repo.id, test_db) is None

    def test_preloaded_map_wins_over_the_query(self, test_db, mock_repo):
        """snapshot_map 是批次路徑的預載結果，命中時不該再打 DB。

        兩條路徑取到不同答案的話，批次與單筆會給出不一致的訊號，而且
        沒有任何錯誤會浮出來。
        """
        _seed(test_db, mock_repo.id, [(0, 2000)])
        preloaded = RepoSnapshot(
            repo_id=mock_repo.id, stars=7777, forks=0, watchers=0, open_issues=0,
            snapshot_date=utc_today(), fetched_at=utc_now(),
        )

        snap = get_snapshot_for_repo(mock_repo.id, test_db, {mock_repo.id: preloaded})

        assert snap is not None and snap.stars == 7777

    def test_falls_back_to_the_query_when_the_map_misses(self, test_db, mock_repo):
        _seed(test_db, mock_repo.id, [(0, 2000)])

        snap = get_snapshot_for_repo(mock_repo.id, test_db, {99999: None})

        assert snap is not None and snap.stars == 2000
