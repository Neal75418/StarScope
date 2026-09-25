"""
Tests for early signals endpoints.
"""

from db.models import EarlySignal
from utils.time import utc_now


class TestEarlySignalsEndpoints:
    """Test cases for /api/early-signals endpoints."""

    def test_list_signals_empty(self, client):
        """Test listing signals when none exist."""
        response = client.get("/api/early-signals")
        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert data["data"]["signals"] == []
        assert data["data"]["total"] == 0

    def test_list_signals_with_filters(self, client, test_db, mock_repo):
        """Test that filters correctly include/exclude signals by type and severity."""
        # Create two signals with different type/severity
        signal_match = EarlySignal(
            repo_id=mock_repo.id,
            signal_type="rising_star",
            severity="high",
            description="Matching signal",
            velocity_value=50.0,
            star_count=1000,
            percentile_rank=85.0,
            baseline_value=36.0,
            context_title="HN title",
            detected_at=utc_now(),
        )
        signal_no_match = EarlySignal(
            repo_id=mock_repo.id,
            signal_type="breakout",
            severity="medium",
            description="Non-matching signal",
            velocity_value=20.0,
            star_count=500,
            percentile_rank=60.0,
            detected_at=utc_now(),
        )
        test_db.add_all([signal_match, signal_no_match])
        test_db.commit()

        # Filter by rising_star + high — should return only the matching signal
        response = client.get("/api/early-signals?signal_type=rising_star&severity=high")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["total"] == 1
        assert data["data"]["signals"][0]["signal_type"] == "rising_star"
        assert data["data"]["signals"][0]["severity"] == "high"
        # 前端依這兩個欄位用模板渲染文案，少了就靜默退回英文 description——
        # 沒有這條的話，router 把它們拿掉整套測試照樣綠
        assert data["data"]["signals"][0]["baseline_value"] == 36.0
        assert data["data"]["signals"][0]["context_title"] == "HN title"

    def test_get_signal_summary(self, client):
        """Test getting signal summary returns correct values for empty DB."""
        response = client.get("/api/early-signals/summary")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        summary = data["data"]
        assert summary["total_active"] == 0
        assert summary["by_type"] == {}
        assert summary["by_severity"] == {}
        assert summary["repos_with_signals"] == 0

    def test_get_repo_signals_not_found(self, client):
        """Test getting signals for nonexistent repo."""
        response = client.get("/api/early-signals/repo/99999")
        assert response.status_code == 404

    def test_acknowledge_signal_not_found(self, client):
        """Test acknowledging a nonexistent signal."""
        response = client.post("/api/early-signals/99999/acknowledge")
        assert response.status_code == 404



class TestArchivedReposAreExcluded:
    """取消追蹤＝封存（unstarred_at 不為 null），而封存前偵測到的訊號還會活 3–7 天。

    EarlySignal 的查詢若不 join Repo，soft_delete 的封存條件只會套在 joinedload 的
    ON 子句上：訊號照樣被撈出來、repo 卻是 None——清單直接 500，摘要多算。
    """

    @staticmethod
    def _seed(test_db):
        from datetime import timedelta
        from db.models import Repo

        live = Repo(owner="o", name="live", full_name="o/live", url="https://github.com/o/live")
        gone = Repo(owner="o", name="gone", full_name="o/gone", url="https://github.com/o/gone",
                    unstarred_at=utc_now())
        test_db.add_all([live, gone])
        test_db.flush()
        for repo in (live, gone):
            test_db.add(EarlySignal(
                repo_id=repo.id, signal_type="sudden_spike", severity="low", description="d",
                detected_at=utc_now(), expires_at=utc_now() + timedelta(days=3), acknowledged=False,
            ))
        test_db.commit()
        return live, gone

    def test_list_skips_signals_of_archived_repos(self, client, test_db):
        live, _ = self._seed(test_db)

        response = client.get("/api/early-signals/?limit=10")

        assert response.status_code == 200
        assert [s["repo_id"] for s in response.json()["data"]["signals"]] == [live.id]

    def test_summary_does_not_count_archived_repos(self, client, test_db):
        self._seed(test_db)

        data = client.get("/api/early-signals/summary").json()["data"]

        assert data["repos_with_signals"] == 1
        assert data["total_active"] == 1

    def test_batch_skips_archived_repos(self, client, test_db):
        # 批次請求在途時剛好取消追蹤：請求裡仍帶著那個 repo 的 id
        live, gone = self._seed(test_db)

        response = client.post("/api/early-signals/batch", json={"repo_ids": [live.id, gone.id]})

        assert response.status_code == 200
        results = response.json()["data"]["results"]
        assert results[str(live.id)]["total"] == 1
        # 每個請求的 id 都有一筆結果（空的也回），封存的那個要是空的
        assert results[str(gone.id)] == {"signals": [], "total": 0}
