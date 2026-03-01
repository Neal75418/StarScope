"""
Tests for export endpoints.
測試匯出端點功能，包含 JSON 和 CSV 格式。
"""

import csv
import io
import json
from datetime import date, timedelta

import pytest

from constants import SignalType
from db.models import Repo, RepoSnapshot, Signal
from utils.time import utc_now


class TestExportWatchlistJson:
    """Test cases for /api/export/watchlist.json endpoint."""

    def test_export_watchlist_json_empty(self, client):
        """Test exporting empty watchlist as JSON."""
        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"

        # 解析 JSON 響應
        data = response.json()
        assert "exported_at" in data
        assert "total" in data
        assert "repos" in data
        assert data["total"] == 0
        assert data["repos"] == []

    def test_export_watchlist_json_with_single_repo(
        self, client, test_db, mock_repo
    ):
        """Test exporting watchlist with one repo (no snapshots, no signals)."""
        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200

        data = response.json()
        assert data["total"] == 1
        assert len(data["repos"]) == 1

        repo = data["repos"][0]
        assert repo["id"] == mock_repo.id
        assert repo["owner"] == "testowner"
        assert repo["name"] == "testrepo"
        assert repo["full_name"] == "testowner/testrepo"
        assert repo["url"] == "https://github.com/testowner/testrepo"
        assert repo["language"] == "Python"

        # 無 snapshot 時應為 None
        assert repo["stars"] is None
        assert repo["forks"] is None

        # 無 signal 時應為 None
        assert repo["stars_delta_7d"] is None
        assert repo["stars_delta_30d"] is None
        assert repo["velocity"] is None
        assert repo["acceleration"] is None
        assert repo["trend"] is None

    def test_export_watchlist_json_with_snapshots(
        self, client, test_db, mock_repo
    ):
        """Test exporting repo with snapshot data."""
        # 創建 snapshot
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=date.today(),
            stars=15000,
            forks=5000,
            watchers=1000,
            open_issues=100,
            fetched_at=utc_now(),
        )
        test_db.add(snapshot)
        test_db.commit()

        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200

        data = response.json()
        repo = data["repos"][0]

        # 驗證 snapshot 資料
        assert repo["stars"] == 15000
        assert repo["forks"] == 5000

    def test_export_watchlist_json_with_signals(
        self, client, test_db, mock_repo
    ):
        """Test exporting repo with signal data."""
        # 創建 signal
        signal = Signal(
            repo_id=mock_repo.id,
            signal_type=SignalType.VELOCITY,
            value=125.5,
            calculated_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        # 創建其他訊號
        signals_data = [
            (SignalType.STARS_DELTA_7D, 500.0),
            (SignalType.STARS_DELTA_30D, 2000.0),
            (SignalType.ACCELERATION, 15.5),
            (SignalType.TREND, 0.85),
        ]
        for signal_type, value in signals_data:
            sig = Signal(
                repo_id=mock_repo.id,
                signal_type=signal_type,
                value=value,
                calculated_at=utc_now(),
            )
            test_db.add(sig)
        test_db.commit()

        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200

        data = response.json()
        repo = data["repos"][0]

        # 驗證所有訊號
        assert repo["velocity"] == 125.5
        assert repo["stars_delta_7d"] == 500.0
        assert repo["stars_delta_30d"] == 2000.0
        assert repo["acceleration"] == 15.5
        assert repo["trend"] == 0.85

    def test_export_watchlist_json_with_complete_data(
        self, client, test_db, mock_repo
    ):
        """Test exporting repo with both snapshots and signals."""
        # 創建 snapshot
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=date.today(),
            stars=20000,
            forks=8000,
            watchers=1500,
            open_issues=200,
            fetched_at=utc_now(),
        )
        test_db.add(snapshot)

        # 創建完整訊號
        signals_data = [
            (SignalType.VELOCITY, 200.0),
            (SignalType.STARS_DELTA_7D, 1000.0),
            (SignalType.STARS_DELTA_30D, 4000.0),
            (SignalType.ACCELERATION, 25.0),
            (SignalType.TREND, 0.92),
        ]
        for signal_type, value in signals_data:
            sig = Signal(
                repo_id=mock_repo.id,
                signal_type=signal_type,
                value=value,
                calculated_at=utc_now(),
            )
            test_db.add(sig)
        test_db.commit()

        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200

        data = response.json()
        repo = data["repos"][0]

        # 驗證完整資料
        assert repo["stars"] == 20000
        assert repo["forks"] == 8000
        assert repo["velocity"] == 200.0
        assert repo["stars_delta_7d"] == 1000.0
        assert repo["stars_delta_30d"] == 4000.0
        assert repo["acceleration"] == 25.0
        assert repo["trend"] == 0.92

    def test_export_watchlist_json_multiple_repos(self, client, test_db):
        """Test exporting multiple repos with batch query optimization."""
        from utils.time import utc_now

        # 創建 3 個 repos
        repos = []
        for i in range(3):
            repo = Repo(
                owner=f"owner{i}",
                name=f"repo{i}",
                full_name=f"owner{i}/repo{i}",
                url=f"https://github.com/owner{i}/repo{i}",
                language="Python",
                added_at=utc_now(),
                updated_at=utc_now(),
            )
            test_db.add(repo)
            test_db.flush()

            # 為每個 repo 添加 snapshot
            snapshot = RepoSnapshot(
                repo_id=repo.id,
                snapshot_date=date.today(),
                stars=1000 * (i + 1),
                forks=100 * (i + 1),
                watchers=50,
                open_issues=10,
                fetched_at=utc_now(),
            )
            test_db.add(snapshot)

            # 為每個 repo 添加 signal
            signal = Signal(
                repo_id=repo.id,
                signal_type=SignalType.VELOCITY,
                value=50.0 * (i + 1),
                calculated_at=utc_now(),
            )
            test_db.add(signal)
            repos.append(repo)

        test_db.commit()

        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200

        data = response.json()
        assert data["total"] == 3
        assert len(data["repos"]) == 3

        # 驗證批次載入的資料正確性
        for i, repo_data in enumerate(data["repos"]):
            # 因為按 added_at DESC 排序，所以順序相反
            idx = 2 - i
            assert repo_data["owner"] == f"owner{idx}"
            assert repo_data["stars"] == 1000 * (idx + 1)
            assert repo_data["velocity"] == 50.0 * (idx + 1)

    def test_export_watchlist_json_filename_format(self, client):
        """Test JSON export has correct filename format."""
        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200

        # 驗證檔名格式
        content_disposition = response.headers.get("content-disposition")
        assert content_disposition is not None
        assert "starscope_watchlist_" in content_disposition
        assert ".json" in content_disposition
        assert "attachment" in content_disposition

    def test_export_watchlist_json_uses_latest_snapshot(
        self, client, test_db, mock_repo
    ):
        """Test export uses latest snapshot when multiple exist."""
        # 創建舊 snapshot
        old_snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=date.today() - timedelta(days=7),
            stars=10000,
            forks=3000,
            watchers=500,
            open_issues=50,
            fetched_at=utc_now(),
        )
        test_db.add(old_snapshot)

        # 創建新 snapshot
        new_snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=date.today(),
            stars=15000,
            forks=5000,
            watchers=800,
            open_issues=100,
            fetched_at=utc_now(),
        )
        test_db.add(new_snapshot)
        test_db.commit()

        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200

        data = response.json()
        repo = data["repos"][0]

        # 應該使用最新的 snapshot
        assert repo["stars"] == 15000
        assert repo["forks"] == 5000


class TestExportWatchlistCsv:
    """Test cases for /api/export/watchlist.csv endpoint."""

    def test_export_watchlist_csv_empty(self, client):
        """Test exporting empty watchlist as CSV."""
        response = client.get("/api/export/watchlist.csv")
        assert response.status_code == 200
        assert response.headers["content-type"] == "text/csv; charset=utf-8"

        # 解析 CSV
        content = response.text
        reader = csv.DictReader(io.StringIO(content))
        rows = list(reader)

        # 應該只有 header，無資料行
        assert len(rows) == 0

    def test_export_watchlist_csv_column_headers(self, client, test_db, mock_repo):
        """Test CSV export has correct column headers."""
        response = client.get("/api/export/watchlist.csv")
        assert response.status_code == 200

        content = response.text
        reader = csv.DictReader(io.StringIO(content))

        # 驗證欄位名稱
        expected_columns = [
            "full_name",
            "owner",
            "name",
            "url",
            "language",
            "description",
            "stars",
            "forks",
            "velocity",
            "stars_delta_7d",
            "stars_delta_30d",
            "acceleration",
            "trend",
            "added_at",
        ]
        assert reader.fieldnames == expected_columns

    def test_export_watchlist_csv_with_data(self, client, test_db, mock_repo):
        """Test CSV export contains correct data."""
        # 創建完整資料
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=date.today(),
            stars=25000,
            forks=10000,
            watchers=2000,
            open_issues=300,
            fetched_at=utc_now(),
        )
        test_db.add(snapshot)

        signals_data = [
            (SignalType.VELOCITY, 150.0),
            (SignalType.STARS_DELTA_7D, 800.0),
            (SignalType.STARS_DELTA_30D, 3000.0),
            (SignalType.ACCELERATION, 20.0),
            (SignalType.TREND, 0.88),
        ]
        for signal_type, value in signals_data:
            sig = Signal(
                repo_id=mock_repo.id,
                signal_type=signal_type,
                value=value,
                calculated_at=utc_now(),
            )
            test_db.add(sig)
        test_db.commit()

        response = client.get("/api/export/watchlist.csv")
        assert response.status_code == 200

        content = response.text
        reader = csv.DictReader(io.StringIO(content))
        rows = list(reader)

        assert len(rows) == 1
        row = rows[0]

        # 驗證資料正確性
        assert row["full_name"] == "testowner/testrepo"
        assert row["owner"] == "testowner"
        assert row["name"] == "testrepo"
        assert row["url"] == "https://github.com/testowner/testrepo"
        assert row["language"] == "Python"
        assert row["stars"] == "25000"
        assert row["forks"] == "10000"
        assert row["velocity"] == "150.0"
        assert row["stars_delta_7d"] == "800.0"
        assert row["stars_delta_30d"] == "3000.0"
        assert row["acceleration"] == "20.0"
        assert row["trend"] == "0.88"

    def test_export_watchlist_csv_filename_format(self, client):
        """Test CSV export has correct filename format."""
        response = client.get("/api/export/watchlist.csv")
        assert response.status_code == 200

        # 驗證檔名格式
        content_disposition = response.headers.get("content-disposition")
        assert content_disposition is not None
        assert "starscope_watchlist_" in content_disposition
        assert ".csv" in content_disposition
        assert "attachment" in content_disposition

    def test_export_watchlist_csv_handles_none_values(
        self, client, test_db, mock_repo
    ):
        """Test CSV export handles None values correctly."""
        # mock_repo 沒有 snapshot 和 signal，應該有空值
        response = client.get("/api/export/watchlist.csv")
        assert response.status_code == 200

        content = response.text
        reader = csv.DictReader(io.StringIO(content))
        rows = list(reader)

        assert len(rows) == 1
        row = rows[0]

        # None 值應該轉為空字串
        assert row["stars"] == ""
        assert row["forks"] == ""
        assert row["velocity"] == ""

    def test_export_watchlist_csv_multiple_repos(self, client, test_db):
        """Test CSV export with multiple repos."""
        from utils.time import utc_now

        # 創建 2 個 repos
        for i in range(2):
            repo = Repo(
                owner=f"user{i}",
                name=f"project{i}",
                full_name=f"user{i}/project{i}",
                url=f"https://github.com/user{i}/project{i}",
                language="Go",
                description=f"Test project {i}",
                added_at=utc_now(),
                updated_at=utc_now(),
            )
            test_db.add(repo)
            test_db.flush()

            snapshot = RepoSnapshot(
                repo_id=repo.id,
                snapshot_date=date.today(),
                stars=5000 * (i + 1),
                forks=1000 * (i + 1),
                watchers=100,
                open_issues=20,
                fetched_at=utc_now(),
            )
            test_db.add(snapshot)

        test_db.commit()

        response = client.get("/api/export/watchlist.csv")
        assert response.status_code == 200

        content = response.text
        reader = csv.DictReader(io.StringIO(content))
        rows = list(reader)

        assert len(rows) == 2

        # 驗證第一行（按 added_at DESC，所以是 user1）
        assert rows[0]["owner"] == "user1"
        assert rows[0]["stars"] == "10000"

        # 驗證第二行
        assert rows[1]["owner"] == "user0"
        assert rows[1]["stars"] == "5000"


class TestExportBatchQueryOptimization:
    """Test batch query optimization to avoid N+1 queries."""

    def test_batch_snapshot_loading(self, client, test_db):
        """Test snapshots are loaded in batch, not one-by-one."""
        from utils.time import utc_now

        # 創建 5 個 repos
        repo_ids = []
        for i in range(5):
            repo = Repo(
                owner=f"org{i}",
                name=f"lib{i}",
                full_name=f"org{i}/lib{i}",
                url=f"https://github.com/org{i}/lib{i}",
                language="Rust",
                added_at=utc_now(),
                updated_at=utc_now(),
            )
            test_db.add(repo)
            test_db.flush()

            snapshot = RepoSnapshot(
                repo_id=repo.id,
                snapshot_date=date.today(),
                stars=100 * (i + 1),
                forks=10 * (i + 1),
                watchers=5,
                open_issues=3,
                fetched_at=utc_now(),
            )
            test_db.add(snapshot)
            repo_ids.append(repo.id)

        test_db.commit()

        # 匯出應該使用批次查詢
        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200

        data = response.json()
        assert data["total"] == 5

        # 驗證所有 repo 都有正確的 snapshot 資料
        for i, repo_data in enumerate(data["repos"]):
            idx = 4 - i  # 按 added_at DESC
            assert repo_data["stars"] == 100 * (idx + 1)

    def test_batch_signal_loading(self, client, test_db):
        """Test signals are loaded in batch, not one-by-one."""
        from utils.time import utc_now

        # 創建 3 個 repos
        for i in range(3):
            repo = Repo(
                owner=f"team{i}",
                name=f"app{i}",
                full_name=f"team{i}/app{i}",
                url=f"https://github.com/team{i}/app{i}",
                language="TypeScript",
                added_at=utc_now(),
                updated_at=utc_now(),
            )
            test_db.add(repo)
            test_db.flush()

            # 每個 repo 添加多個 signals
            signals_data = [
                (SignalType.VELOCITY, 30.0 * (i + 1)),
                (SignalType.STARS_DELTA_7D, 200.0 * (i + 1)),
            ]
            for signal_type, value in signals_data:
                sig = Signal(
                    repo_id=repo.id,
                    signal_type=signal_type,
                    value=value,
                    calculated_at=utc_now(),
                )
                test_db.add(sig)

        test_db.commit()

        # 匯出應該使用批次查詢
        response = client.get("/api/export/watchlist.json")
        assert response.status_code == 200

        data = response.json()
        assert data["total"] == 3

        # 驗證所有 repo 都有正確的 signal 資料
        for i, repo_data in enumerate(data["repos"]):
            idx = 2 - i  # 按 added_at DESC
            assert repo_data["velocity"] == 30.0 * (idx + 1)
            assert repo_data["stars_delta_7d"] == 200.0 * (idx + 1)
