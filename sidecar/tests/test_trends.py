"""
Tests for trends endpoints.
"""


class TestTrendsEndpoints:
    """Test cases for /api/trends endpoints."""

    def test_get_trends_empty(self, client):
        """Test getting trends when no repos exist."""
        response = client.get("/api/trends/")
        assert response.status_code == 200
        data = response.json()
        # 驗證統一的 API 響應格式
        assert data["success"] is True
        assert data["data"]["repos"] == []
        assert data["data"]["total"] == 0
        assert data["data"]["sort_by"] == "velocity"
        assert "velocity" in data["message"]  # message 包含 sort_by 資訊

    def test_get_trends_with_sort(self, client, test_db):
        """Test that sort_by parameter changes the result ordering."""
        from db.models import Repo, Signal
        from utils.time import utc_now
        from constants import SignalType

        # Create 2 repos: repo_a has higher velocity, repo_b has higher stars_delta_7d
        repo_a = Repo(
            owner="alpha", name="fast", full_name="alpha/fast",
            url="https://github.com/alpha/fast",
            language="Python", added_at=utc_now(), updated_at=utc_now(),
        )
        repo_b = Repo(
            owner="beta", name="popular", full_name="beta/popular",
            url="https://github.com/beta/popular",
            language="Python", added_at=utc_now(), updated_at=utc_now(),
        )
        test_db.add_all([repo_a, repo_b])
        test_db.flush()

        # repo_a: velocity=100, stars_delta_7d=10
        test_db.add(Signal(repo_id=repo_a.id, signal_type=SignalType.VELOCITY, value=100.0, calculated_at=utc_now()))
        test_db.add(Signal(repo_id=repo_a.id, signal_type=SignalType.STARS_DELTA_7D, value=10.0, calculated_at=utc_now()))
        # repo_b: velocity=20, stars_delta_7d=500
        test_db.add(Signal(repo_id=repo_b.id, signal_type=SignalType.VELOCITY, value=20.0, calculated_at=utc_now()))
        test_db.add(Signal(repo_id=repo_b.id, signal_type=SignalType.STARS_DELTA_7D, value=500.0, calculated_at=utc_now()))
        test_db.commit()

        # Sort by velocity — alpha/fast should be first
        resp_vel = client.get("/api/trends/?sort_by=velocity")
        repos_vel = resp_vel.json()["data"]["repos"]
        assert len(repos_vel) == 2, f"Expected 2 repos, got {len(repos_vel)}"
        assert repos_vel[0]["full_name"] == "alpha/fast"

        # Sort by stars_delta_7d — beta/popular should be first
        resp_delta = client.get("/api/trends/?sort_by=stars_delta_7d")
        repos_delta = resp_delta.json()["data"]["repos"]
        assert len(repos_delta) == 2, f"Expected 2 repos, got {len(repos_delta)}"
        assert repos_delta[0]["full_name"] == "beta/popular"

    def test_get_trends_with_limit(self, client, test_db):
        """Test that limit parameter restricts the number of returned repos."""
        from db.models import Repo, Signal
        from utils.time import utc_now
        from constants import SignalType

        # Create 3 repos with velocity signals
        for i in range(3):
            repo = Repo(
                owner=f"org{i}", name=f"lib{i}", full_name=f"org{i}/lib{i}",
                url=f"https://github.com/org{i}/lib{i}",
                language="Python", added_at=utc_now(), updated_at=utc_now(),
            )
            test_db.add(repo)
            test_db.flush()
            test_db.add(Signal(
                repo_id=repo.id, signal_type=SignalType.VELOCITY,
                value=10.0 * (i + 1), calculated_at=utc_now(),
            ))
        test_db.commit()

        # Without limit — should return all 3
        resp_all = client.get("/api/trends/")
        assert resp_all.json()["data"]["total"] == 3

        # With limit=2 — should return at most 2
        resp_limited = client.get("/api/trends/?limit=2")
        assert resp_limited.status_code == 200
        data = resp_limited.json()
        assert data["success"] is True
        assert len(data["data"]["repos"]) == 2

    def test_get_trends_invalid_sort(self, client):
        """Test getting trends with invalid sort option returns validation error."""
        response = client.get("/api/trends/?sort_by=invalid")
        assert response.status_code == 422


class TestTrendsOnlyRanksReposThatHaveTheMetric:
    """
    依某個指標排序時，沒有那個指標的 repo 不該出現在榜上。

    原本是 OUTER JOIN 配 coalesce(value, 0)，把「沒資料」當成「零成長」。
    2026-08-22 實測：signals 表裡沒有半筆 stars_delta_30d，於是 94 個 repo
    全部並列 0，順序由資料庫決定——第 5 名是七天只漲 62 顆星的專案，而漲了
    2,033 的不在前六。看起來卻像一份真的排行榜。
    """

    def _seed(self, test_db):
        from db.models import Repo, Signal
        from utils.time import utc_now
        from constants import SignalType

        repos = {}
        for owner, name in [("a", "has-30d"), ("b", "no-30d"), ("c", "also-no-30d")]:
            r = Repo(
                owner=owner, name=name, full_name=f"{owner}/{name}",
                url=f"https://github.com/{owner}/{name}",
                added_at=utc_now(), updated_at=utc_now(),
            )
            test_db.add(r)
            repos[name] = r
        test_db.flush()

        # 三個都有 velocity，只有一個有 30 天增量
        for name, vel in [("has-30d", 5.0), ("no-30d", 900.0), ("also-no-30d", 800.0)]:
            test_db.add(Signal(repo_id=repos[name].id, signal_type=SignalType.VELOCITY,
                               value=vel, calculated_at=utc_now()))
        test_db.add(Signal(repo_id=repos["has-30d"].id, signal_type=SignalType.STARS_DELTA_30D,
                           value=42.0, calculated_at=utc_now()))
        test_db.commit()
        return repos

    def test_only_repos_with_the_metric_are_ranked(self, client, test_db):
        self._seed(test_db)

        repos = client.get("/api/trends/?sort_by=stars_delta_30d").json()["data"]["repos"]

        # 缺 30 天資料的兩個 velocity 高得多，coalesce 版本會把它們混進榜單
        assert [r["full_name"] for r in repos] == ["a/has-30d"]

    def test_metric_with_no_data_at_all_returns_an_empty_ranking(self, client, test_db):
        self._seed(test_db)

        body = client.get("/api/trends/?sort_by=acceleration").json()["data"]

        assert body["repos"] == []
        assert body["total"] == 0

    def test_sorts_that_do_have_data_are_unaffected(self, client, test_db):
        self._seed(test_db)

        repos = client.get("/api/trends/?sort_by=velocity").json()["data"]["repos"]

        assert [r["full_name"] for r in repos] == ["b/no-30d", "c/also-no-30d", "a/has-30d"]


class TestTrendsReportsWhichSortsHaveNoData:
    """
    空的排序鍵要回報給前端。

    只做 INNER JOIN 的話，按下「30天變化」會落到前端的 emptyFiltered 文案
    ——那句話叫使用者「放寬語言或最低星數」，但真正的原因是歷史資料還不夠。
    """

    def test_empty_sorts_lists_metrics_with_no_signals(self, client, test_db):
        from db.models import Repo, Signal
        from utils.time import utc_now
        from constants import SignalType

        r = Repo(owner="a", name="b", full_name="a/b", url="https://github.com/a/b",
                 added_at=utc_now(), updated_at=utc_now())
        test_db.add(r)
        test_db.flush()
        test_db.add(Signal(repo_id=r.id, signal_type=SignalType.VELOCITY,
                           value=1.0, calculated_at=utc_now()))
        test_db.commit()

        empty = client.get("/api/trends/").json()["data"]["empty_sorts"]

        assert "velocity" not in empty
        for key in ("stars_delta_30d", "acceleration", "forks_delta_7d", "issues_delta_7d"):
            assert key in empty, f"{key} 沒有任何訊號，應該被列為空"

    def test_empty_sorts_survives_the_response_model(self, client):
        """
        response_model 會靜默丟掉未宣告的欄位——這個專案被咬過兩次
        （repos_compared、releases_ever_fetched）。這條測的是「電線有沒有通」，
        不是後端算得對不對。
        """
        body = client.get("/api/trends/").json()["data"]

        assert "empty_sorts" in body, "欄位沒有出現在 HTTP 回應裡（多半是 schema 沒宣告）"
        assert isinstance(body["empty_sorts"], list)


class TestTrendStableIsNotMissing:
    """
    trend 為 0 代表「持平」，不是「沒有資料」。

    原本寫 `int(trend_val) if trend_val else None`，0.0 是 falsy，於是持平的
    repo 回 None，前端畫成「—」（無資料）而不是「→」（持平）。2026-08-22 實測
    10 個 repo 中招，同一個 repo 在追蹤清單 API 回 0、在趨勢 API 回 None。
    """

    def test_zero_trend_is_reported_as_zero(self, client, test_db):
        from db.models import Repo, Signal
        from utils.time import utc_now
        from constants import SignalType

        r = Repo(owner="flat", name="repo", full_name="flat/repo",
                 url="https://github.com/flat/repo", added_at=utc_now(), updated_at=utc_now())
        test_db.add(r)
        test_db.flush()
        test_db.add(Signal(repo_id=r.id, signal_type=SignalType.VELOCITY,
                           value=0.1, calculated_at=utc_now()))
        test_db.add(Signal(repo_id=r.id, signal_type=SignalType.TREND,
                           value=0.0, calculated_at=utc_now()))
        test_db.commit()

        repos = client.get("/api/trends/?sort_by=velocity").json()["data"]["repos"]

        assert repos[0]["trend"] == 0, "持平被回報成 None，前端會畫成「無資料」"
        assert repos[0]["trend"] is not None

    def test_missing_trend_is_still_none(self, client, test_db):
        """真的沒有 trend 訊號時仍然回 None——修法不能把兩者反過來混淆。"""
        from db.models import Repo, Signal
        from utils.time import utc_now
        from constants import SignalType

        r = Repo(owner="unknown", name="repo", full_name="unknown/repo",
                 url="https://github.com/unknown/repo", added_at=utc_now(), updated_at=utc_now())
        test_db.add(r)
        test_db.flush()
        test_db.add(Signal(repo_id=r.id, signal_type=SignalType.VELOCITY,
                           value=0.1, calculated_at=utc_now()))
        test_db.commit()

        repos = client.get("/api/trends/?sort_by=velocity").json()["data"]["repos"]

        assert repos[0]["trend"] is None
